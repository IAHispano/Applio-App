//! Plugin preferences and installation are owned by the native job coordinator.
use crate::{
    engine::{JobResult, NativeEngine},
    jobs::JobType,
    process::ManagedProcess,
    processing_routes::{accepted, path_string, Accepted, Error},
    scheduler::Resource,
    uploads::{self, UploadRule},
};
use anyhow::{bail, Context, Result};
use axum::{
    extract::{DefaultBodyLimit, Request, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub fn router(engine: Arc<NativeEngine>) -> Router {
    Router::new()
        .route("/api/plugins", get(list))
        .route("/api/plugins/toggle", post(toggle))
        .route("/api/plugins/install", post(install))
        .layer(DefaultBodyLimit::disable())
        .with_state(engine)
}
fn installed(engine: &NativeEngine) -> PathBuf {
    engine.runtime.data.join("plugins/installed")
}
fn enabled(config: &Value) -> Vec<String> {
    config["plugins"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}
fn set_enabled(engine: &NativeEngine, name: &str, enable: bool) -> Result<()> {
    engine.runtime.config.modify(|config| {
        let mut entries = enabled(config);
        if enable && !entries.iter().any(|entry| entry == name) {
            entries.push(name.into());
        }
        if !enable {
            entries.retain(|entry| entry != name);
        }
        config["plugins"] = json!(entries);
        Ok(())
    })?;
    Ok(())
}
async fn list(State(engine): State<Arc<NativeEngine>>) -> Result<Json<Value>, Error> {
    let root = installed(&engine);
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(Error::internal)?;
    let enabled = enabled(&engine.runtime.config.load()?);
    let mut seen = HashSet::new();
    let mut plugins = Vec::new();
    for (directory, legacy) in [
        (root, false),
        (engine.runtime.data.join("tabs/plugins/installed"), true),
    ] {
        let mut entries = match tokio::fs::read_dir(&directory).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(Error::internal(error)),
        };
        let mut paths = Vec::new();
        while let Some(entry) = entries.next_entry().await.map_err(Error::internal)? {
            paths.push(entry.path());
        }
        paths.sort();
        for path in paths {
            if !path.is_dir() {
                continue;
            }
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            if name.starts_with(".applio-install-") || !seen.insert(name.clone()) {
                continue;
            }
            let mut plugin = json!({"name":name,"enabled":enabled.contains(&name),"hasEntrypoint":path.join("plugin.py").exists()});
            if legacy {
                plugin["legacy"] = json!(true);
            }
            plugins.push(plugin);
        }
    }
    Ok(Json(json!({"plugins":plugins})))
}
#[derive(Deserialize)]
struct Toggle {
    name: String,
    enabled: bool,
}
async fn toggle(
    State(engine): State<Arc<NativeEngine>>,
    request: Request,
) -> Result<Json<Value>, Error> {
    let input = uploads::parse(request, &engine.runtime.uploads, &[]).await?;
    let body: Toggle =
        serde_json::from_value(input.body.clone()).map_err(|_| Error::input("Invalid params"))?;
    let name = body.name.rsplit(['/', '\\']).next().unwrap_or("");
    if name.is_empty() || matches!(name, "." | "..") {
        return Err(Error::input("Invalid params"));
    }
    if !installed(&engine).join(name).is_dir() {
        return Err(Error(
            StatusCode::NOT_FOUND,
            json!({"error":"Plugin not installed"}),
        ));
    }
    set_enabled(&engine, name, body.enabled).map_err(Error::internal)?;
    Ok(Json(json!({"ok":true,"requiresRestart":true})))
}
struct Staging(PathBuf);
impl Drop for Staging {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
async fn install(State(engine): State<Arc<NativeEngine>>, request: Request) -> Accepted {
    let input = uploads::parse(
        request,
        &engine.runtime.uploads,
        &[UploadRule {
            name: "file",
            extensions: &["zip"],
            max_bytes: 500 * 1024 * 1024,
            max_files: 1,
        }],
    )
    .await?;
    let file = input.files.get("file").context("Upload a 'file' (.zip).")?;
    let basename = file
        .original_name
        .strip_suffix(".zip")
        .unwrap_or(&file.original_name);
    let folder: String = basename
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let folder = if folder.is_empty() || matches!(folder.as_str(), "." | "..") {
        "plugin".into()
    } else {
        folder
    };
    if folder.starts_with(".applio-install-") {
        return Err(Error::input("Reserved plugin folder name"));
    }
    let archive = file.path.clone();
    let root = installed(&engine);
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(Error::internal)?;
    let job = engine
        .start_job(
            JobType::Other,
            json!({"plugin":folder}),
            Some(Resource::Network),
            move |engine, job, token| async move {
                // Keep multipart ownership alive until extraction completes or is cancelled.
                let _input = input;
                let _installation = tokio::select! {
                    _ = token.cancelled() => bail!("Stopped by user"),
                    guard = engine.plugin_install.lock() => guard,
                };
                let staging = Staging(root.join(format!(".applio-install-{}", Uuid::new_v4())));
                tokio::fs::create_dir(&staging.0).await?;
                let dest = root.join(&folder);
                if tokio::fs::symlink_metadata(&dest)
                    .await
                    .is_ok_and(|m| !m.is_dir() || linked(&m))
                {
                    bail!("Plugin destination is not a regular directory");
                }
                if dest.exists() {
                    // Preserve files from earlier installs, matching extractall's merge.
                    let source = std::fs::canonicalize(&dest)?;
                    if !source.starts_with(std::fs::canonicalize(&root)?) {
                        bail!("Plugin destination escapes installed plugins");
                    }
                    copy_tree(&source, &staging.0, &token).await?;
                }
                let args = vec![
                    "-c".into(),
                    EXTRACT.into(),
                    path_string(&archive),
                    path_string(&staging.0),
                ];
                let output = ManagedProcess::run(
                    &engine.runtime.python_command(args)?,
                    &token,
                    |_, line| engine.jobs.log(&job.id, line),
                )
                .await?;
                output.ensure_success()?;
                if token.is_cancelled() {
                    bail!("Stopped by user");
                }
                publish(&root, &folder, &staging.0)?;
                set_enabled(&engine, &folder, true)?;
                let requirements = dest.join("requirements.txt");
                if requirements.is_file() {
                    let plugin = folder.clone();
                    // Preserve the public follow-up pip job contract; the requirements
                    // process is still cancellable and owned by the native engine.
                    engine
                        .start_job(
                            JobType::Other,
                            json!({"plugin":plugin,"step":"pip-install"}),
                            Some(Resource::Network),
                            move |engine, job, token| async move {
                                let output = ManagedProcess::run(
                                    &engine.runtime.python_command(vec![
                                        "-m".into(),
                                        "pip".into(),
                                        "install".into(),
                                        "-r".into(),
                                        path_string(&requirements),
                                    ])?,
                                    &token,
                                    |_, line| engine.jobs.log(&job.id, line),
                                )
                                .await?;
                                output.ensure_success()?;
                                Ok(JobResult::new(
                                    json!({"message":"Plugin dependencies installed."}),
                                    None,
                                ))
                            },
                        )
                        .await?;
                }
                Ok(JobResult::new(
                    json!({"name":folder,"requiresRestart":true}),
                    None,
                ))
            },
        )
        .await?;
    Ok(accepted(job))
}
async fn copy_tree(source: &Path, destination: &Path, token: &CancellationToken) -> Result<()> {
    let mut pending = vec![(source.to_owned(), destination.to_owned())];
    while let Some((source, destination)) = pending.pop() {
        let mut entries = tokio::fs::read_dir(source).await?;
        while let Some(entry) = entries.next_entry().await? {
            if token.is_cancelled() {
                bail!("Stopped by user");
            }
            let kind = entry.file_type().await?;
            if linked(&tokio::fs::symlink_metadata(entry.path()).await?) {
                bail!("Plugin contains a symbolic link or junction");
            }
            let target = destination.join(entry.file_name());
            if kind.is_dir() {
                tokio::fs::create_dir(&target).await?;
                pending.push((entry.path(), target));
            } else if kind.is_file() {
                tokio::fs::copy(entry.path(), target).await?;
            } else {
                bail!("Plugin contains an unsupported file type");
            }
        }
    }
    Ok(())
}
fn linked(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}
#[derive(Serialize, Deserialize)]
struct Publication {
    folder: String,
    staging: String,
    backup: String,
}
fn journal(root: &Path) -> PathBuf {
    root.join(".applio-install.json")
}
fn simple_name(name: &str) -> bool {
    !name.is_empty()
        && !matches!(name, "." | "..")
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
}
fn owned_name(name: &str) -> bool {
    name.strip_prefix(".applio-install-")
        .is_some_and(|id| Uuid::parse_str(id).is_ok())
}
/// Recover only explicitly journaled, confined installation directories.
/// A crash between the two renames restores the previous plugin on next boot.
pub(crate) fn recover(root: &Path) -> Result<()> {
    let path = journal(root);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    let publication: Publication =
        serde_json::from_slice(&bytes).context("Invalid plugin installation journal")?;
    if !simple_name(&publication.folder)
        || publication.folder.starts_with(".applio-install-")
        || !owned_name(&publication.staging)
        || !owned_name(&publication.backup)
        || publication.staging == publication.backup
    {
        bail!("Invalid plugin installation paths");
    }
    let dest = root.join(&publication.folder);
    let staging = root.join(&publication.staging);
    let backup = root.join(&publication.backup);
    for directory in [&dest, &staging, &backup] {
        if let Ok(metadata) = std::fs::symlink_metadata(directory) {
            if linked(&metadata) || !metadata.is_dir() {
                bail!("Plugin recovery path is not a regular directory");
            }
        }
    }
    if dest.exists() && staging.exists() && backup.exists() {
        bail!("Conflicting plugin installation recovery paths");
    }
    if !dest.exists() && backup.exists() {
        std::fs::rename(&backup, &dest)?;
    }
    if staging.exists() {
        std::fs::remove_dir_all(&staging)?;
    }
    if backup.exists() && dest.exists() {
        std::fs::remove_dir_all(&backup)?;
    }
    std::fs::remove_file(path)?;
    Ok(())
}
fn publish(root: &Path, folder: &str, staging: &Path) -> Result<()> {
    recover(root)?;
    let backup = format!(".applio-install-{}", Uuid::new_v4());
    let publication = Publication {
        folder: folder.into(),
        staging: staging
            .file_name()
            .context("Missing staging folder")?
            .to_str()
            .context("Invalid staging folder")?
            .into(),
        backup: backup.clone(),
    };
    let dest = root.join(folder);
    crate::storage::atomic_json(&journal(root), &serde_json::to_value(publication)?)?;
    let result = (|| {
        if dest.exists() {
            std::fs::rename(&dest, root.join(&backup))?;
        }
        std::fs::rename(staging, &dest)?;
        Ok::<_, anyhow::Error>(())
    })();
    // Synchronous publication/recovery keeps shutdown from aborting between
    // renames. The journal also handles process crashes and power loss.
    let recovered = recover(root);
    result?;
    recovered
}
const EXTRACT: &str = r#"
import os, pathlib, stat, sys, zipfile
root = pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as archive:
    total = 0
    for entry in archive.infolist():
        name = entry.filename.replace('\\', '/')
        parts = pathlib.PurePosixPath(name)
        if parts.is_absolute() or '..' in parts.parts or ':' in name or stat.S_ISLNK(entry.external_attr >> 16):
            raise ValueError('Unsafe plugin archive entry: ' + entry.filename)
        target = (root / name).resolve()
        if target != root and root not in target.parents:
            raise ValueError('Plugin archive escapes its folder')
        total += entry.file_size
        if total > 2 * 1024**3:
            raise ValueError('Unpacked plugin exceeds 2 GiB')
    archive.extractall(root)
print('extracted', flush=True)
"#;
