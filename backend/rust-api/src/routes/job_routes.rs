//! HTTP/SSE contracts for the native job engine. Mounted by the native engine
//! router when the processing route groups are switched over together.
use crate::{
    jobs::{EventKind, JobStore},
    scheduler::Scheduler,
};
use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::{convert::Infallible, time::Duration};
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
struct JobsState {
    jobs: JobStore,
    scheduler: Scheduler,
    cancelled: CancellationToken,
}

pub fn router(jobs: JobStore, scheduler: Scheduler) -> Router {
    router_with_shutdown(jobs, scheduler, CancellationToken::new())
}
pub fn router_with_shutdown(
    jobs: JobStore,
    scheduler: Scheduler,
    cancelled: CancellationToken,
) -> Router {
    Router::new()
        .route("/api/jobs", get(list))
        .route("/api/jobs/activity", get(activity))
        .route("/api/jobs/events", get(all_events))
        .route("/api/jobs/{id}", get(one))
        .route("/api/jobs/{id}/events", get(job_events))
        .route("/api/jobs/{id}/stop", post(stop))
        .with_state(JobsState {
            jobs,
            scheduler,
            cancelled,
        })
}

fn not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({"error": "Job not found"})),
    )
        .into_response()
}

async fn list(State(state): State<JobsState>) -> Json<Value> {
    Json(json!({"jobs": state.jobs.public_list(20), "scheduling": state.scheduler.status()}))
}
async fn activity(State(state): State<JobsState>) -> Json<Value> {
    Json(json!({"jobs": state.jobs.activity()}))
}
async fn one(State(state): State<JobsState>, Path(id): Path<String>) -> Response {
    match state.jobs.get(&id) {
        Some(job) => Json(json!({"job": job.public_value(None)})).into_response(),
        None => not_found(),
    }
}
async fn stop(State(state): State<JobsState>, Path(id): Path<String>) -> Response {
    if state.jobs.get(&id).is_none() {
        return not_found();
    }
    let cancelled = state.jobs.cancel(&id, "Stopped by user");
    Json(if cancelled {
        json!({"ok": true})
    } else {
        json!({"ok": true, "alreadyFinished": true})
    })
    .into_response()
}

fn event(value: Value) -> Result<Event, Infallible> {
    Ok(Event::default().data(value.to_string()))
}
fn stream_response(
    stream: impl futures_util::Stream<Item = Result<Event, Infallible>> + Send + 'static,
) -> Response {
    let mut response = Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .event(Event::default().event("heartbeat").data("")),
        )
        .into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        "no-cache, no-transform".parse().unwrap(),
    );
    response
        .headers_mut()
        .insert("x-accel-buffering", "no".parse().unwrap());
    response
}

async fn job_events(State(state): State<JobsState>, Path(id): Path<String>) -> Response {
    let Some((initial, mut receiver)) = state.jobs.subscribe_job(&id) else {
        return not_found();
    };
    stream_response(async_stream::stream! {
        yield event(json!({"job": initial.public_value(None)}));
        if !initial.active() { return; }
        loop {
            let update=tokio::select! {
                biased;
                _=state.cancelled.cancelled()=>{
                    if let Some(job)=state.jobs.get(&id) {yield event(json!({"job":job.public_value(None)}));}
                    break;
                },
                update=receiver.recv()=>update,
            };
            match update {
                Ok(update) if update.job.id == id => {
                    yield event(json!({"job": update.job.public_value(None)}));
                    if !update.job.active() { break; }
                }
                Ok(_) => {}
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    // Discard the old receiver before resynchronizing. Replaying
                    // its buffered older events could regress terminal states.
                    let Some((current, new_receiver)) = state.jobs.subscribe_job(&id) else { break; };
                    receiver = new_receiver;
                    yield event(json!({"job": current.public_value(None)}));
                    if !current.active() { break; }
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    })
}

async fn all_events(State(state): State<JobsState>) -> Response {
    let (initial, mut receiver) = state.jobs.subscribe_activity();
    stream_response(async_stream::stream! {
        yield event(json!({"jobs": initial}));
        loop {
            let update=tokio::select! {
                biased;
                _=state.cancelled.cancelled()=>{
                    yield event(json!({"jobs":state.jobs.activity()}));
                    break;
                },
                update=receiver.recv()=>update,
            };
            match update {
                Ok(update) if update.kind == EventKind::State => yield event(json!({"job": update.job.summary()})),
                Ok(_) => {}
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    let (current, new_receiver) = state.jobs.subscribe_activity();
                    receiver = new_receiver;
                    yield event(json!({"jobs": current}));
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    })
}
