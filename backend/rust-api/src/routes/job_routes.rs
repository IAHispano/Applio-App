//! HTTP/SSE contracts for the native job engine. Mounted by the native engine
//! router when the processing route groups are switched over together.
use crate::{
    jobs::{BatchSubscription, JobStore, JobSubscription, HISTORY_LOG_TAIL},
    scheduler::Scheduler,
};
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
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
        .route("/api/jobs/dashboard", get(dashboard))
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

#[derive(Deserialize)]
struct ListQuery {
    compact: Option<bool>,
}

async fn list(State(state): State<JobsState>, Query(query): Query<ListQuery>) -> Json<Value> {
    let jobs = if query.compact == Some(true) {
        state.jobs.history_cards()
    } else {
        state.jobs.public_list(HISTORY_LOG_TAIL)
    };
    Json(json!({"jobs": jobs, "scheduling": state.scheduler.status()}))
}
async fn activity(State(state): State<JobsState>, headers: HeaderMap) -> Response {
    let (tag, summaries) = state.jobs.activity_if_changed(|tag| {
        headers.get_all(header::IF_NONE_MATCH).iter().any(|field| {
            let field = field.as_bytes();
            // Quoted opaque tags can contain commas. Compare complete quoted values.
            field.trim_ascii() == b"*"
                || field
                    .split(|byte| *byte == b'"')
                    .skip(1)
                    .step_by(2)
                    .any(|value| value == &tag.as_bytes()[1..tag.len() - 1])
        })
    });
    let mut response = match summaries {
        Some(jobs) => Json(json!({"jobs": jobs})).into_response(),
        None => StatusCode::NOT_MODIFIED.into_response(),
    };
    response
        .headers_mut()
        .insert(header::ETAG, tag.parse().unwrap());
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}
async fn dashboard(State(state): State<JobsState>) -> Json<Value> {
    Json(state.jobs.dashboard())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobQuery {
    batch_page: Option<usize>,
    log_tail: Option<usize>,
}

async fn one(
    State(state): State<JobsState>,
    Path(id): Path<String>,
    Query(query): Query<JobQuery>,
) -> Response {
    match state.jobs.public_job(&id, query.batch_page, query.log_tail) {
        Some(job) => Json(json!({"job": job})).into_response(),
        None => not_found(),
    }
}
async fn stop(State(state): State<JobsState>, Path(id): Path<String>) -> Response {
    if state.jobs.cancellation(&id).is_none() {
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

#[derive(Deserialize)]
struct JobEventsQuery {
    batch: Option<String>,
}

async fn job_events(
    State(state): State<JobsState>,
    Path(id): Path<String>,
    Query(query): Query<JobEventsQuery>,
) -> Response {
    if query.batch.as_deref() == Some("true") {
        return batch_events(state, id);
    }
    let Some(JobSubscription { snapshot, updates }) = state.jobs.subscribe_job(&id) else {
        return not_found();
    };
    stream_response(async_stream::stream! {
        yield event(json!({"job": snapshot.public_value(None)}));
        let Some(mut receiver) = updates else { return; };
        loop {
            let update=tokio::select! {
                biased;
                _=state.cancelled.cancelled()=>{
                    if let Some(job)=state.jobs.public_job(&id, None, None) {yield event(json!({"job":job}));}
                    break;
                },
                update=receiver.recv()=>update,
            };
            match update {
                Ok(job) => {
                    yield event(json!({"job": job.public_value(None)}));
                    if !job.active() { break; }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    // Discard the old receiver before resynchronizing. Replaying
                    // its buffered older events could regress terminal states.
                    let Some(JobSubscription { snapshot, updates }) = state.jobs.subscribe_job(&id) else { break; };
                    yield event(json!({"job": snapshot.public_value(None)}));
                    let Some(new_receiver) = updates else { break; };
                    receiver = new_receiver;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    })
}

fn batch_events(state: JobsState, id: String) -> Response {
    let Some(BatchSubscription { snapshot, updates }) = state.jobs.subscribe_batch(&id) else {
        return not_found();
    };
    stream_response(async_stream::stream! {
        yield event(json!({"job": snapshot.as_ref()}));
        let Some(mut updates) = updates else { return; };
        loop {
            let changed = tokio::select! {
                biased;
                _=state.cancelled.cancelled()=>{
                    if let Some(job)=state.jobs.public_job(&id, Some(0), None) {yield event(json!({"job":job}));}
                    break;
                },
                update=updates.changed()=>update,
            };
            if changed.is_err() { break; }
            let job = updates.borrow_and_update().clone();
            yield event(json!({"job": job.as_ref()}));
            if job["status"] == "done" || job["status"] == "error" { break; }
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
                Ok(summary) => yield event(json!({"job": summary.as_ref()})),
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
