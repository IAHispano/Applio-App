use crate::{engine::NativeEngine, processing_routes::Error, uploads};
use axum::{
    extract::{
        ws::{Message, WebSocketUpgrade},
        DefaultBodyLimit, Request, State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};

pub fn router(engine: Arc<NativeEngine>) -> Router {
    Router::new()
        .route("/api/realtime/status", get(status))
        .route("/api/realtime/prewarm", post(prewarm))
        .route("/api/realtime/start", post(start))
        .route("/api/realtime/stop", post(stop))
        .route("/api/realtime/record", post(record))
        .route("/api/realtime/config", get(config).put(save_config))
        .route("/api/realtime/ws-audio", get(audio))
        .route("/api/realtime/change-config", get(change_config))
        .layer(DefaultBodyLimit::disable())
        .with_state(engine)
}
async fn status(State(engine): State<Arc<NativeEngine>>) -> Json<Value> {
    let active = engine.realtime.active().is_some();
    let running = active && engine.realtime.reachable().await;
    let mut status = engine.realtime.status();
    status["running"] = json!(running);
    status["scheduling"] = json!(engine.scheduler.status());
    Json(status)
}
async fn ready(engine: &NativeEngine) -> Result<(), Error> {
    engine.require_ready(false).await.map_err(|error| {
        Error(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error":error.to_string()}),
        )
    })
}
async fn prewarm(State(engine): State<Arc<NativeEngine>>) -> Result<Json<Value>, Error> {
    let generation = engine.realtime.generation();
    ready(&engine).await?;
    let (started_at, reused) = engine
        .realtime
        .start(&engine, generation)
        .await
        .map_err(Error::internal)?;
    if reused && engine.realtime.reachable().await {
        Ok(Json(
            json!({"ok":true,"running":true,"startedAt":started_at}),
        ))
    } else {
        Ok(Json(json!({"ok":true,"starting":true})))
    }
}
async fn start(State(engine): State<Arc<NativeEngine>>) -> Result<Json<Value>, Error> {
    engine
        .scheduler
        .preempt_background_gpu(&engine.cancellation_token())
        .await
        .map_err(Error::internal)?;
    let generation = engine.realtime.generation();
    if engine.scheduler.gpu_busy() {
        return Err(Error(
            StatusCode::CONFLICT,
            json!({"error":"A GPU job is running. Stop it or wait for it to finish before starting realtime."}),
        ));
    }
    ready(&engine).await?;
    let (started_at, reused) = engine
        .realtime
        .start(&engine, generation)
        .await
        .map_err(Error::internal)?;
    let (_, cancelled) = engine
        .realtime
        .active()
        .ok_or_else(|| Error::internal("Realtime engine exited."))?;
    for _ in 0..300 {
        if cancelled.is_cancelled() || engine.realtime.generation() != generation {
            return Err(Error::internal("Realtime start cancelled by stop"));
        }
        if engine.realtime.active().is_none() {
            return Err(Error(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"error":"Realtime engine exited. Check uvicorn is installed and a GPU/model is available.","logs":engine.realtime.status()["logs"]}),
            ));
        }
        if engine.realtime.reachable().await {
            let mut body = json!({"ok":true,"startedAt":started_at});
            if reused {
                body["reused"] = json!(true);
            }
            return Ok(Json(body));
        }
        tokio::select! {_=cancelled.cancelled()=>{},_=tokio::time::sleep(Duration::from_millis(100))=>{}}
    }
    Err(Error(
        StatusCode::GATEWAY_TIMEOUT,
        json!({"error":"Realtime engine did not come up in time.","logs":engine.realtime.status()["logs"]}),
    ))
}
async fn stop(State(engine): State<Arc<NativeEngine>>) -> Result<Json<Value>, Error> {
    engine.realtime.stop().await.map_err(Error::internal)?;
    Ok(Json(json!({"ok":true})))
}
async fn config(State(engine): State<Arc<NativeEngine>>) -> Result<Json<Value>, Error> {
    let config = engine.runtime.config.load().map_err(Error::internal)?;
    Ok(Json(
        json!({"realtime":config.get("realtime").filter(|v|!v.is_null()).cloned().unwrap_or_else(||json!({}))}),
    ))
}
async fn save_config(
    State(engine): State<Arc<NativeEngine>>,
    request: Request,
) -> Result<Json<Value>, Error> {
    let input = uploads::parse(request, &engine.runtime.uploads, &[]).await?;
    let body = input
        .body
        .as_object()
        .ok_or_else(|| Error::input("Settings must be an object"))?;
    let config = engine
        .runtime
        .config
        .modify(|config| {
            if !config["realtime"].is_object() {
                config["realtime"] = json!({});
            }
            let realtime = config["realtime"].as_object_mut().unwrap();
            for (key, value) in body {
                if !matches!(key.as_str(), "__proto__" | "constructor" | "prototype") {
                    realtime.insert(key.clone(), value.clone());
                }
            }
            Ok(())
        })
        .map_err(Error::internal)?;
    Ok(Json(json!({"ok":true,"realtime":config["realtime"]})))
}
async fn record(
    State(engine): State<Arc<NativeEngine>>,
    request: Request,
) -> Result<(StatusCode, Json<Value>), Error> {
    let input = uploads::parse(request, &engine.runtime.uploads, &[]).await?;
    let (_, cancelled) = engine.realtime.active().ok_or_else(|| {
        Error(
            StatusCode::BAD_GATEWAY,
            json!({"error":"Engine unreachable: realtime is stopped"}),
        )
    })?;
    let operation = async {
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(30))
            .build()?;
        let response = client
            .post(format!("http://127.0.0.1:{}/record", engine.realtime.port))
            .json(&input.body)
            .send()
            .await?;
        let status = response.status();
        let body = response.json::<Value>().await.unwrap_or_else(|_| json!({}));
        Ok::<_, anyhow::Error>((status, Json(body)))
    };
    tokio::select! {
        _=cancelled.cancelled()=>Err(Error(StatusCode::BAD_GATEWAY,json!({"error":"Engine unreachable: realtime stopped"}))),
        result=operation=>result.map_err(|error|Error(StatusCode::BAD_GATEWAY,json!({"error":format!("Engine unreachable: {error}")}))),
    }
}
async fn audio(State(engine): State<Arc<NativeEngine>>, ws: WebSocketUpgrade) -> Response {
    socket(engine, ws, true).await
}
async fn change_config(State(engine): State<Arc<NativeEngine>>, ws: WebSocketUpgrade) -> Response {
    socket(engine, ws, false).await
}
async fn socket(engine: Arc<NativeEngine>, ws: WebSocketUpgrade, audio: bool) -> Response {
    let Some((_, mut cancelled)) = engine.realtime.active() else {
        return Error(
            StatusCode::BAD_GATEWAY,
            json!({"error":"Realtime engine unavailable"}),
        )
        .into_response();
    };
    let session = if audio {
        if let Err(error) = engine.scheduler.preempt_background_gpu(&cancelled).await {
            return Error::internal(error).into_response();
        }
        let Some(guard) = engine.realtime.begin_audio(&engine) else {
            return Error(StatusCode::CONFLICT, json!({"error":"GPU is busy."})).into_response();
        };
        cancelled = guard.stopped.clone();
        // Guard cancellation retains the lease in the supervisor until the
        // process is stopped, even if this upgrade request is abandoned.
        let result = tokio::select! {_=cancelled.cancelled()=>Err(anyhow::anyhow!("Realtime stopped")),result=engine.worker.stop()=>result};
        if let Err(error) = result {
            return Error::internal(error).into_response();
        }
        Some(guard)
    } else {
        None
    };
    let url = format!(
        "ws://127.0.0.1:{}/{}",
        engine.realtime.port,
        if audio { "ws-audio" } else { "change-config" }
    );
    let upstream = tokio::select! {
        _=cancelled.cancelled()=>return Error(StatusCode::BAD_GATEWAY,json!({"error":"Realtime stopped"})).into_response(),
        upstream=tokio::time::timeout(Duration::from_secs(15),tokio_tungstenite::connect_async_with_config(url,None,true))=>upstream,
    };
    let upstream = match upstream {
        Ok(Ok((socket, _))) => socket,
        Ok(Err(tokio_tungstenite::tungstenite::Error::Http(response))) => {
            return Error(
                response.status(),
                json!({"error":"Realtime engine rejected the connection"}),
            )
            .into_response()
        }
        _ => {
            return Error(
                StatusCode::BAD_GATEWAY,
                json!({"error":"Realtime engine unavailable"}),
            )
            .into_response()
        }
    };
    ws.max_message_size(16 * 1024 * 1024)
        .on_upgrade(move |client| async move {
            let _session = session;
            let (mut client_sink, mut client_stream) = client.split();
            let (mut engine_sink, mut engine_stream) = upstream.split();
            let to_engine = async {
                while let Some(Ok(message)) = client_stream.next().await {
                    use tokio_tungstenite::tungstenite::Message as Upstream;
                    let message = match message {
                        Message::Text(text) => Upstream::Text(text.to_string().into()),
                        Message::Binary(data) => Upstream::Binary(data),
                        Message::Ping(data) => Upstream::Ping(data),
                        Message::Pong(data) => Upstream::Pong(data),
                        Message::Close(_) => break,
                    };
                    if tokio::time::timeout(Duration::from_secs(15), engine_sink.send(message))
                        .await
                        .map_or(true, |r| r.is_err())
                    {
                        break;
                    }
                }
            };
            let to_client = async {
                while let Some(Ok(message)) = engine_stream.next().await {
                    use tokio_tungstenite::tungstenite::Message as Upstream;
                    let message = match message {
                        Upstream::Text(text) => Message::Text(text.to_string().into()),
                        Upstream::Binary(data) => Message::Binary(data),
                        Upstream::Ping(data) => Message::Ping(data),
                        Upstream::Pong(data) => Message::Pong(data),
                        Upstream::Close(_) => break,
                        Upstream::Frame(_) => continue,
                    };
                    if tokio::time::timeout(Duration::from_secs(15), client_sink.send(message))
                        .await
                        .map_or(true, |r| r.is_err())
                    {
                        break;
                    }
                }
            };
            tokio::select! {_=cancelled.cancelled()=>{},_=to_engine=>{},_=to_client=>{}}
            // Dropping the audio guard requests process shutdown. The supervisor
            // drops the GPU lease only after stopping the owned process tree.
        })
        .into_response()
}
