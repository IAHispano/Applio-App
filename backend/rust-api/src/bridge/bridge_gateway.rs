//! Private remote-access gateway. Only browser pairing routes are public; an
//! approved cookie grants the explicit remote API capability set, never IPC.
use crate::{
    bridge_page, bridge_policy,
    bridge_sessions::{Device, Sessions},
};
use anyhow::{bail, Result};
use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Request, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Router,
};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio_util::sync::CancellationToken;
pub const COOKIE: &str = "__Host-applio_bridge";
pub const MAX_UPLOAD: usize = 100 * 1024 * 1024;
struct Origin {
    url: String,
    host: String,
}
#[derive(Default)]
struct Rate {
    window: i64,
    attempts: u32,
}
pub type PairingLanguage = Arc<dyn Fn() -> (String, Value) + Send + Sync>;
pub struct Gateway {
    pub sessions: Sessions,
    origin: Mutex<Option<Origin>>,
    rate: Mutex<Rate>,
    web_port: u16,
    api_port: u16,
    font: Option<Bytes>,
    language: PairingLanguage,
    on_request: Arc<dyn Fn(Device) + Send + Sync>,
    pub stopped: CancellationToken,
    client: reqwest::Client,
}
struct Serving {
    gateway: Arc<Gateway>,
    housekeeping: tokio::task::JoinHandle<()>,
}
impl Drop for Serving {
    fn drop(&mut self) {
        self.gateway.stop();
        self.housekeeping.abort();
    }
}
impl Drop for Gateway {
    fn drop(&mut self) {
        self.sessions.clear();
        self.stopped.cancel();
    }
}
impl Gateway {
    pub fn new(
        web_port: u16,
        api_port: u16,
        font: Option<Vec<u8>>,
        language: PairingLanguage,
        on_request: Arc<dyn Fn(Device) + Send + Sync>,
        stopped: CancellationToken,
    ) -> Result<Arc<Self>> {
        Ok(Arc::new(Self {
            sessions: Sessions::default(),
            origin: Mutex::new(None),
            rate: Mutex::default(),
            web_port,
            api_port,
            font: font.map(Bytes::from),
            language,
            on_request,
            stopped,
            client: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .read_timeout(Duration::from_secs(180))
                .build()?,
        }))
    }
    pub fn set_origin(&self, origin: &str) -> Result<()> {
        let url = reqwest::Url::parse(origin)?;
        if !matches!(url.scheme(), "http" | "https") {
            bail!("Invalid Bridge origin");
        }
        let origin = url.origin().ascii_serialization();
        let host = origin.split_once("://").unwrap().1.to_owned();
        *self.origin.lock().unwrap() = Some(Origin { url: origin, host });
        Ok(())
    }
    pub fn stop(&self) {
        self.sessions.clear();
        self.stopped.cancel();
        *self.origin.lock().unwrap() = None;
    }
    pub fn router(self: &Arc<Self>) -> Router {
        Router::new()
            .fallback(handle)
            .layer(DefaultBodyLimit::disable())
            .with_state(self.clone())
    }
    pub async fn serve(self: Arc<Self>, listener: tokio::net::TcpListener) -> Result<()> {
        let prune = self.clone();
        let housekeeping = tokio::spawn(async move {
            loop {
                tokio::select! {_=prune.stopped.cancelled()=>break,_=tokio::time::sleep(Duration::from_secs(5))=>{prune.sessions.list();}}
            }
        });
        let _serving = Serving {
            gateway: self.clone(),
            housekeeping,
        };
        let result = axum::serve(listener, self.router())
            .with_graceful_shutdown(self.stopped.clone().cancelled_owned())
            .await;
        self.stop();
        Ok(result?)
    }
}
fn json_response(status: StatusCode, value: Value) -> Response {
    (status, axum::Json(value)).into_response()
}
fn error(status: StatusCode, message: impl ToString) -> Response {
    json_response(status, json!({"error":message.to_string()}))
}
fn security(response: &mut Response) {
    for (name, value) in [
        ("referrer-policy", "no-referrer"),
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "DENY"),
    ] {
        response.headers_mut().insert(name, value.parse().unwrap());
    }
    response
        .headers_mut()
        .entry(header::CACHE_CONTROL)
        .or_insert("no-store".parse().unwrap());
}
pub(crate) fn valid_path(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len()
                || !bytes[i + 1].is_ascii_hexdigit()
                || !bytes[i + 2].is_ascii_hexdigit()
            {
                return false;
            }
            i += 3;
        } else {
            i += 1;
        }
    }
    let Ok(decoded) = percent_encoding::percent_decode_str(raw).decode_utf8() else {
        return false;
    };
    let ambiguous = |path: &str| {
        path.contains('\\')
            || path.contains("//")
            || path.split('/').any(|part| matches!(part, "." | ".."))
    };
    if decoded.is_empty() || decoded.chars().any(char::is_control) {
        return false;
    }
    if decoded == raw && !ambiguous(raw) {
        return true;
    }
    let lower = raw.to_ascii_lowercase();
    ["/outputs/", "/assets/", "/_next/static/"]
        .iter()
        .any(|prefix| raw.starts_with(prefix))
        && !decoded.contains('%')
        && !ambiguous(&decoded)
        && !lower.contains("%2f")
        && !lower.contains("%5c")
}
async fn handle(State(gateway): State<Arc<Gateway>>, request: Request) -> Response {
    let mut response = dispatch(gateway, request).await;
    security(&mut response);
    response
}
async fn dispatch(gateway: Arc<Gateway>, request: Request) -> Response {
    if request.headers().contains_key(header::UPGRADE) {
        return error(
            StatusCode::FORBIDDEN,
            "Bridge WebSocket upgrades are not allowed",
        );
    }
    let origin = {
        let state = gateway.origin.lock().unwrap();
        state
            .as_ref()
            .map(|origin| (origin.url.clone(), origin.host.clone()))
    };
    let Some((origin, host)) = origin else {
        return error(StatusCode::MISDIRECTED_REQUEST, "Bridge is not ready");
    };
    if request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        != Some(&host)
    {
        return error(StatusCode::MISDIRECTED_REQUEST, "Bridge is not ready");
    }
    let raw = request.uri().path();
    if request.uri().scheme().is_some() || !valid_path(raw) {
        return error(StatusCode::BAD_REQUEST, "Invalid bridge path");
    }
    let path = raw.trim_end_matches('/');
    let path = if path.is_empty() { "/" } else { path };
    let method = request.method().as_str();
    let safe = matches!(method, "GET" | "HEAD");
    if !safe
        && request
            .headers()
            .get(header::ORIGIN)
            .and_then(|v| v.to_str().ok())
            != Some(&origin)
    {
        return error(
            StatusCode::FORBIDDEN,
            "Cross-origin requests are not allowed",
        );
    }
    let cookie = request
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            v.split(';')
                .map(str::trim)
                .find_map(|part| part.strip_prefix(&format!("{COOKIE}=")))
        });
    let authorization = gateway.sessions.find(cookie);
    if path == "/bridge/syne.ttf" && safe {
        let Some(font) = &gateway.font else {
            return error(StatusCode::NOT_FOUND, "Font unavailable");
        };
        return Response::builder()
            .status(200)
            .header(header::CONTENT_TYPE, "font/ttf")
            .header(header::CONTENT_LENGTH, font.len())
            .header(header::CACHE_CONTROL, "public, max-age=86400")
            .body(if method == "HEAD" {
                Body::empty()
            } else {
                Body::from(font.clone())
            })
            .unwrap();
    }
    if path == "/bridge" && method == "GET" {
        let (language, dictionary) = (gateway.language)();
        return match bridge_page::pairing_page(&language,&dictionary){
            Ok((html,nonce))=>Response::builder().status(200).header(header::CONTENT_TYPE,"text/html; charset=utf-8").header("content-security-policy",format!("default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")).body(Body::from(html)).unwrap(),
            Err(_)=>error(StatusCode::INTERNAL_SERVER_ERROR,"Bridge page unavailable"),
        };
    }
    if path == "/bridge/session" && method == "GET" {
        return match authorization {
            Some(auth) => json_response(
                StatusCode::OK,
                json!({"status":auth.device.status,"code":auth.device.code,"expiresAt":auth.device.expires_at}),
            ),
            None => json_response(StatusCode::UNAUTHORIZED, json!({"status":"expired"})),
        };
    }
    if path == "/bridge/logout" && method == "POST" {
        let mut response = json_response(StatusCode::OK, json!({"ok":true}));
        response.headers_mut().insert(
            header::SET_COOKIE,
            format!("{COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0")
                .parse()
                .unwrap(),
        );
        if let Some(auth) = authorization {
            gateway.sessions.revoke(&auth.device.id);
        }
        return response;
    }
    if path == "/bridge/pair" && method == "POST" {
        let blocked = {
            let mut rate = gateway.rate.lock().unwrap();
            let now = chrono::Utc::now().timestamp_millis();
            if now - rate.window > 60000 {
                rate.window = now;
                rate.attempts = 0;
            }
            rate.attempts += 1;
            rate.attempts > 20
        };
        if blocked {
            return error(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many requests. Try again in a minute.",
            );
        }
        if !request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("application/json"))
        {
            return error(StatusCode::UNSUPPORTED_MEDIA_TYPE, "Expected JSON");
        }
        let bytes = match axum::body::to_bytes(request.into_body(), 4096).await {
            Ok(bytes) => bytes,
            Err(_) => return error(StatusCode::PAYLOAD_TOO_LARGE, "Request too large"),
        };
        let body = match serde_json::from_slice::<Value>(&bytes) {
            Ok(body) => body,
            Err(_) => return error(StatusCode::BAD_REQUEST, "Invalid invitation"),
        };
        let Some(invite) = body["invite"].as_str().filter(|v| v.len() <= 128) else {
            return error(StatusCode::BAD_REQUEST, "Invalid invitation");
        };
        let Some(name) = body["name"].as_str() else {
            return error(StatusCode::BAD_REQUEST, "Invalid invitation");
        };
        if authorization
            .as_ref()
            .is_some_and(|auth| auth.device.status == "approved")
        {
            return error(StatusCode::CONFLICT, "This browser is already connected");
        }
        if let Some(auth) = authorization {
            gateway.sessions.revoke(&auth.device.id);
        }
        return match gateway.sessions.request(invite, name) {
            Ok((credential, device)) => {
                let mut response = json_response(StatusCode::ACCEPTED, json!({"status":"pending"}));
                response.headers_mut().insert(header::SET_COOKIE,format!("{COOKIE}={credential}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age={}",8*60*60).parse().unwrap());
                (gateway.on_request)(device);
                response
            }
            Err(failure) => error(StatusCode::BAD_REQUEST, failure),
        };
    }
    if path.starts_with("/bridge") {
        return error(StatusCode::NOT_FOUND, "Unknown bridge endpoint");
    }
    let Some(auth) = authorization.filter(|auth| auth.device.status == "approved") else {
        if method == "GET"
            && !path.starts_with("/api/")
            && request
                .headers()
                .get(header::ACCEPT)
                .and_then(|v| v.to_str().ok())
                .is_some_and(|v| v.contains("text/html"))
        {
            return Response::builder()
                .status(303)
                .header(header::LOCATION, "/bridge")
                .body(Body::empty())
                .unwrap();
        }
        return error(
            StatusCode::UNAUTHORIZED,
            "Approve this device on the host computer first",
        );
    };
    let api = path.to_ascii_lowercase().starts_with("/api/") || path.eq_ignore_ascii_case("/api");
    if api && !bridge_policy::api_allowed(method, path) || !api && !safe {
        return error(
            StatusCode::FORBIDDEN,
            "This feature is available on the host computer only",
        );
    }
    if request
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .is_some_and(|v| v > MAX_UPLOAD as u64)
    {
        return error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Bridge uploads are limited to 100 MB",
        );
    }
    let port = if api
        || path == "/assets"
        || path.starts_with("/assets/")
        || path == "/outputs"
        || path.starts_with("/outputs/")
    {
        gateway.api_port
    } else {
        gateway.web_port
    };
    proxy(gateway, request, port, auth.cancelled).await
}
fn strip_hop(headers: &mut HeaderMap) {
    let nominated = headers
        .get(header::CONNECTION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(',')
        .map(|v| v.trim().to_ascii_lowercase())
        .collect::<Vec<_>>();
    for name in nominated {
        headers.remove(name);
    }
    for name in [
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ] {
        headers.remove(name);
    }
}
async fn proxy(
    gateway: Arc<Gateway>,
    request: Request,
    port: u16,
    cancelled: CancellationToken,
) -> Response {
    let (mut parts, body) = request.into_parts();
    strip_hop(&mut parts.headers);
    let private = parts
        .headers
        .keys()
        .filter(|name| {
            let name = name.as_str();
            name.starts_with("x-forwarded-")
                || name.starts_with("cf-")
                || matches!(
                    name,
                    "cookie"
                        | "authorization"
                        | "forwarded"
                        | "origin"
                        | "host"
                        | "x-applio-compat-token"
                )
        })
        .cloned()
        .collect::<Vec<_>>();
    for name in private {
        parts.headers.remove(name);
    }
    let url = format!(
        "http://127.0.0.1:{port}{}",
        parts.uri.path_and_query().map_or("/", |v| v.as_str())
    );
    let exceeded = Arc::new(AtomicBool::new(false));
    let limit = exceeded.clone();
    let stop = gateway.stopped.clone();
    let revoked = cancelled.clone();
    let upload: futures_util::stream::BoxStream<'static, std::io::Result<Bytes>> = Box::pin(
        async_stream::try_stream! {
            let mut transferred=0usize;let mut stream=body.into_data_stream();
            loop {
                let chunk=tokio::select! {biased;_=stop.cancelled()=>break,_=revoked.cancelled()=>break,chunk=tokio::time::timeout(Duration::from_secs(180),stream.next())=>chunk};
                let chunk=chunk.map_err(|_|std::io::Error::new(std::io::ErrorKind::TimedOut,"Host request timed out"))?;
                let Some(chunk)=chunk else{break;};let chunk=chunk.map_err(std::io::Error::other)?;
                transferred=transferred.saturating_add(chunk.len());if transferred>MAX_UPLOAD {limit.store(true,Ordering::SeqCst);Err(std::io::Error::other("Bridge uploads are limited to 100 MB"))?;}
                yield chunk;
            }
        },
    );
    let request = gateway
        .client
        .request(parts.method, url)
        .headers(parts.headers)
        .body(reqwest::Body::wrap_stream(upload));
    let upstream = tokio::select! {biased;_=gateway.stopped.cancelled()=>return error(StatusCode::BAD_GATEWAY,"Bridge stopped"),_=cancelled.cancelled()=>return error(StatusCode::UNAUTHORIZED,"Bridge access expired"),response=request.send()=>response};
    if exceeded.load(Ordering::SeqCst) {
        return error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Bridge uploads are limited to 100 MB",
        );
    }
    match upstream {
        Ok(upstream) => {
            let status = upstream.status();
            let mut headers = upstream.headers().clone();
            strip_hop(&mut headers);
            headers.remove(header::SET_COOKIE);
            let cors = headers
                .keys()
                .filter(|name| name.as_str().starts_with("access-control-"))
                .cloned()
                .collect::<Vec<_>>();
            for name in cors {
                headers.remove(name);
            }
            headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
            let stop = gateway.stopped.clone();
            let stream: futures_util::stream::BoxStream<'static, Result<Bytes, reqwest::Error>> =
                Box::pin(async_stream::try_stream! {
                    let mut stream=upstream.bytes_stream();
                    loop {
                        let chunk=tokio::select! {biased;_=stop.cancelled()=>break,_=cancelled.cancelled()=>break,chunk=stream.next()=>chunk};
                        let Some(chunk)=chunk else{break;};yield chunk?;
                    }
                });
            let mut response = Response::new(Body::from_stream(stream));
            *response.status_mut() = status;
            *response.headers_mut() = headers;
            response
        }
        Err(_) if exceeded.load(Ordering::SeqCst) => error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Bridge uploads are limited to 100 MB",
        ),
        Err(_) => error(
            StatusCode::BAD_GATEWAY,
            "The host service is unavailable. Keep Applio running.",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tower::ServiceExt;

    #[test]
    fn rejects_ambiguous_paths_before_proxying() {
        for path in [
            "/api/../setup",
            "/api/%2e%2e/setup",
            "/api%2fsettings",
            "/assets/%252e%252e/secret",
            "/outputs/a%5cb.wav",
            "/api//settings",
            "/api/%00",
            "/api/%zz",
        ] {
            assert!(!valid_path(path), "{path}");
        }
        for path in [
            "/api/settings",
            "/outputs/my%20audio.wav",
            "/_next/static/chunk.js",
        ] {
            assert!(valid_path(path), "{path}");
        }
    }

    #[tokio::test]
    async fn approval_does_not_grant_host_only_routes_and_revocation_removes_access() {
        let gateway = Gateway::new(
            3000,
            8000,
            None,
            Arc::new(|| ("en_US".into(), json!({}))),
            Arc::new(|_| {}),
            CancellationToken::new(),
        )
        .unwrap();
        gateway.set_origin("https://bridge.example").unwrap();
        let invite = gateway.sessions.new_invite().unwrap();
        let (credential, device) = gateway.sessions.request(&invite.token, "test").unwrap();
        let request = |method: &str, path: &str| {
            Request::builder()
                .method(method)
                .uri(path)
                .header(header::HOST, "bridge.example")
                .header(header::ORIGIN, "https://bridge.example")
                .header(header::COOKIE, format!("{COOKIE}={credential}"))
                .body(Body::empty())
                .unwrap()
        };
        let app = gateway.router();
        assert_eq!(
            app.clone()
                .oneshot(request("GET", "/api/health"))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        gateway.sessions.approve(&device.id).unwrap();
        for (method, path) in [
            ("POST", "/api/setup/install"),
            ("POST", "/api/plugins/install"),
            ("PUT", "/api/settings"),
            ("POST", "/api/settings/restart"),
            ("GET", "/api/settings/storage"),
            ("GET", "/api/jobs/events"),
            ("POST", "/api/realtime/start"),
        ] {
            assert_eq!(
                app.clone()
                    .oneshot(request(method, path))
                    .await
                    .unwrap()
                    .status(),
                StatusCode::FORBIDDEN,
                "{method} {path}"
            );
        }
        let mut cross_origin = request("POST", "/api/inference");
        cross_origin
            .headers_mut()
            .insert(header::ORIGIN, "https://attacker.example".parse().unwrap());
        assert_eq!(
            app.clone().oneshot(cross_origin).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        gateway.sessions.revoke(&device.id);
        assert_eq!(
            app.oneshot(request("GET", "/api/health"))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }
}
