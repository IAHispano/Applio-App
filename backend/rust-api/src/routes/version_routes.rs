use crate::{
    engine::NativeEngine,
    process::{CommandSpec, ManagedProcess},
    processing_routes::Error,
};
use anyhow::{bail, Result};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    cmp::Ordering,
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
const RELEASES: &str = "https://api.github.com/repos/IAHispano/Applio-App/releases?per_page=30";
struct Versions {
    engine: Arc<NativeEngine>,
    url: String,
    cache: tokio::sync::Mutex<Option<(Instant, Value)>>,
    update: tokio::sync::Mutex<()>,
}
pub fn router(engine: Arc<NativeEngine>) -> Router {
    router_with_url(engine, RELEASES.into())
}
pub(crate) fn router_with_url(engine: Arc<NativeEngine>, url: String) -> Router {
    Router::new()
        .route("/api/settings/version-check", get(check))
        .route("/api/settings/apply-update", post(apply))
        .with_state(Arc::new(Versions {
            engine,
            url,
            cache: tokio::sync::Mutex::new(None),
            update: tokio::sync::Mutex::new(()),
        }))
}
#[derive(Clone, Debug, Default, Deserialize)]
pub(crate) struct Asset {
    pub name: String,
    pub browser_download_url: String,
}
#[derive(Clone, Debug, Default, Deserialize)]
pub(crate) struct Release {
    pub tag_name: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub html_url: Option<String>,
    #[serde(default)]
    pub assets: Vec<Asset>,
}
fn clean(value: &str) -> &str {
    value.trim().trim_start_matches(['v', 'V'])
}
fn components(value: &str) -> Vec<f64> {
    clean(value)
        .split('.')
        .map(|part| part.parse::<f64>().unwrap_or(0.))
        .collect()
}
fn compare(a: &str, b: &str) -> Ordering {
    let (a, b) = (components(a), components(b));
    for i in 0..a.len().max(b.len()) {
        let order = a
            .get(i)
            .unwrap_or(&0.)
            .partial_cmp(b.get(i).unwrap_or(&0.))
            .unwrap_or(Ordering::Equal);
        if order != Ordering::Equal {
            return order;
        }
    }
    Ordering::Equal
}
pub(crate) fn summarize(
    local: &str,
    releases: &[Release],
    platform: &str,
    arch: &str,
    dev: bool,
) -> Value {
    let Some(release) = releases.first() else {
        return json!({"local":local,"latest":local,"status":"up-to-date","versionsBehind":0,"isOutdated":false,"isDev":dev});
    };
    let latest = if clean(&release.tag_name).is_empty() {
        "unknown".into()
    } else {
        format!("v{}", clean(&release.tag_name))
    };
    let unknown = local.trim().is_empty()
        || matches!(
            local.trim().to_ascii_lowercase().as_str(),
            "unknown" | "vunknown"
        );
    let status = if unknown {
        "unknown"
    } else {
        match compare(local, &release.tag_name) {
            Ordering::Less => "behind",
            Ordering::Equal => "up-to-date",
            Ordering::Greater => "ahead",
        }
    };
    let extension = match platform {
        "win32" => ".exe",
        "darwin" => ".dmg",
        _ => ".appimage",
    };
    let matching = release
        .assets
        .iter()
        .filter(|asset| asset.name.to_ascii_lowercase().ends_with(extension))
        .collect::<Vec<_>>();
    let arm = matches!(arch, "arm64" | "aarch64");
    let asset = matching
        .iter()
        .find(|asset| {
            let name = asset.name.to_ascii_lowercase();
            (name.contains("arm64") || name.contains("aarch64")) == arm
        })
        .copied()
        .or_else(|| matching.first().copied());
    let html = release
        .html_url
        .clone()
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| {
            format!("https://github.com/IAHispano/Applio-App/releases/tag/{latest}")
        });
    let download = asset
        .or_else(|| release.assets.first())
        .map(|asset| asset.browser_download_url.as_str())
        .filter(|url| !url.is_empty())
        .unwrap_or(&html);
    let behind = if status == "behind" {
        let count = releases
            .iter()
            .filter(|release| compare(&release.tag_name, local) == Ordering::Greater)
            .count() as u64;
        let (a, b) = (components(local), components(&release.tag_name));
        let gap = (0..3)
            .map(|i| (b.get(i).unwrap_or(&0.) - a.get(i).unwrap_or(&0.)).max(0.) as u64)
            .collect::<Vec<_>>();
        let gap = if gap[0] > 0 {
            gap[0].saturating_mul(10)
        } else if gap[1] > 0 {
            gap[1].saturating_mul(2)
        } else {
            gap[2]
        };
        count.max(gap.max(1))
    } else {
        0
    };
    json!({"local":if unknown{"unknown".into()}else{format!("v{}",clean(local))},"latest":latest,"status":status,"versionsBehind":behind,"isOutdated":status=="behind"&&behind>=2,"isDev":dev,"releaseName":release.name.clone().filter(|v|!v.is_empty()).unwrap_or_else(||format!("Applio {latest}")),"releaseNotes":release.body.clone().unwrap_or_default(),"publishedAt":release.published_at.clone().unwrap_or_default(),"htmlUrl":html,"downloadUrl":download})
}
async fn check(
    State(state): State<Arc<Versions>>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, Error> {
    let mut cache = state.cache.lock().await;
    if query.get("refresh").is_none_or(|v| v != "1") {
        if let Some((at, value)) = &*cache {
            if at.elapsed() < Duration::from_secs(3600) {
                return Ok(Json(value.clone()));
            }
        }
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("Applio")
        .build()
        .map_err(Error::internal)?;
    let mut request = client
        .get(&state.url)
        .header("accept", "application/vnd.github+json");
    if let Some(token) = state.engine.runtime.env("GITHUB_TOKEN") {
        if !token.is_empty() {
            request = request.bearer_auth(token.to_string_lossy());
        }
    }
    let token = state.engine.cancellation_token();
    let operation = async {
        let response = request.send().await?.error_for_status()?;
        Ok::<_, anyhow::Error>(response.json::<Vec<Release>>().await?)
    };
    let releases = tokio::select! {_=token.cancelled()=>return Err(Error::internal("Applio is shutting down")),result=operation=>result.map_err(|error|Error(StatusCode::BAD_GATEWAY,json!({"error":error.to_string()})))?};
    let dev = state
        .engine
        .runtime
        .env("NODE_ENV")
        .is_some_and(|v| v == "development")
        || state
            .engine
            .runtime
            .env("APPLIO_DEV")
            .is_some_and(|v| v == "1");
    let value = summarize(
        env!("CARGO_PKG_VERSION"),
        &releases,
        crate::setup_install::platform(),
        std::env::consts::ARCH,
        dev,
    );
    *cache = Some((Instant::now(), value.clone()));
    Ok(Json(value))
}
async fn git(engine: &NativeEngine, args: &[&str]) -> Result<String> {
    let spec = CommandSpec::new("git", &engine.runtime.code).args(args.iter().copied());
    let token = engine.cancellation_token();
    let output = tokio::time::timeout(
        Duration::from_secs(45),
        ManagedProcess::run(&spec, &token, |_, _| {}),
    )
    .await??;
    output.ensure_success()?;
    Ok(output.stdout)
}
async fn apply(State(state): State<Arc<Versions>>) -> Result<Json<Value>, Error> {
    let _update = state.update.lock().await;
    let engine = &state.engine;
    if !engine.runtime.code.join(".git").exists() {
        return Ok(Json(
            json!({"success":false,"method":"manual","message":"Not a git repository. Please download and run the latest installer."}),
        ));
    }
    let operation = async {
        let _admission = engine.begin_source_update()?;
        if !git(engine, &["status", "--porcelain"])
            .await?
            .trim()
            .is_empty()
        {
            bail!("Commit or stash local changes before updating.");
        }
        engine.worker.stop().await?;
        engine.realtime.stop().await?;
        // Never turn an update into a merge of divergent histories.
        git(engine, &["pull", "--ff-only"]).await?;
        let version = tokio::fs::read(engine.runtime.code.join("package.json"))
            .await
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .and_then(|pkg| pkg["version"].as_str().map(str::to_owned))
            .unwrap_or_else(|| env!("CARGO_PKG_VERSION").into());
        Ok::<_, anyhow::Error>(Json(
            json!({"success":true,"method":"git","version":version,"message":"Repository updated. Rebuild and restart the application to load the new version."}),
        ))
    };
    let result = operation.await.map_err(Error::internal)?;
    *state.cache.lock().await = None;
    Ok(result)
}
