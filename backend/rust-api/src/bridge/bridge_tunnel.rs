//! Pinned Cloudflare helper verification and public-route readiness. Invitation
//! creation happens only after the helper reaches the owned pairing gateway.
use crate::{
    download,
    process::{CommandSpec, ManagedProcess, ProcessEvent},
};
use anyhow::{bail, Context, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::io::AsyncReadExt;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
const MAX_HELPER: u64 = 128 * 1024 * 1024;
#[derive(Clone, Debug)]
pub struct Asset {
    pub version: String,
    pub platform: String,
    pub name: String,
    pub sha256: String,
}
pub fn asset(platform: &str, arch: &str) -> Result<Asset> {
    let manifest: Value = serde_json::from_str(include_str!("bridge-helper.json"))?;
    let arch = match arch {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        value => value,
    };
    let platform = format!("{platform}-{arch}");
    let item = &manifest["assets"][&platform];
    let name = item[0]
        .as_str()
        .context("Bridge Mode is not supported on this computer architecture.")?;
    Ok(Asset {
        version: manifest["version"].as_str().unwrap().into(),
        platform,
        name: name.into(),
        sha256: item[1].as_str().unwrap().into(),
    })
}
async fn valid(path: &Path, expected: &str) -> bool {
    let operation = async {
        let mut file = tokio::fs::File::open(path).await?;
        if file.metadata().await?.len() > MAX_HELPER {
            bail!("Helper too large");
        }
        let mut hash = Sha256::new();
        let mut bytes = vec![0; 128 * 1024];
        loop {
            let length = file.read(&mut bytes).await?;
            if length == 0 {
                break;
            }
            hash.update(&bytes[..length]);
        }
        Ok::<_, anyhow::Error>(format!("{:x}", hash.finalize()) == expected)
    };
    operation.await.unwrap_or(false)
}
pub async fn install(cache: &Path, token: &CancellationToken) -> Result<PathBuf> {
    let asset = asset(crate::setup_install::platform(), std::env::consts::ARCH)?;
    let url = format!(
        "https://github.com/cloudflare/cloudflared/releases/download/{}/{}",
        asset.version, asset.name
    );
    install_from(cache, &asset, &url, token).await
}
pub(crate) async fn install_from(
    cache: &Path,
    asset: &Asset,
    url: &str,
    token: &CancellationToken,
) -> Result<PathBuf> {
    let directory = cache.join(&asset.version).join(&asset.platform);
    tokio::fs::create_dir_all(&directory).await?;
    let download = directory.join(&asset.name);
    if !valid(&download, &asset.sha256).await {
        let transfer = token.child_token();
        let stop = transfer.clone();
        let oversized = Arc::new(AtomicBool::new(false));
        let large = oversized.clone();
        let result = tokio::time::timeout(
            Duration::from_secs(120),
            download::file(
                &download::client()?,
                url,
                &download,
                Some(&asset.sha256),
                &transfer,
                move |received, total| {
                    if received > MAX_HELPER || total > MAX_HELPER {
                        large.store(true, Ordering::SeqCst);
                        stop.cancel();
                    }
                },
                |_| {},
            ),
        )
        .await;
        if oversized.load(Ordering::SeqCst) {
            bail!("Unexpected Bridge helper download size.");
        }
        result.context("Bridge helper download timed out")??;
    }
    if token.is_cancelled() {
        bail!("Bridge startup cancelled.");
    }
    let binary = if asset.name.ends_with(".tgz") {
        let archive = download.clone();
        let directory = directory.clone();
        tokio::task::spawn_blocking(move || extract(&archive, &directory)).await??
    } else {
        download
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).await?;
    }
    Ok(binary)
}
fn extract(archive: &Path, directory: &Path) -> Result<PathBuf> {
    let file = std::fs::File::open(archive)?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(file));
    let temporary = directory.join(format!(".cloudflared-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        for entry in archive.entries()? {
            let mut entry = entry?;
            if entry.path()?.as_ref() != Path::new("cloudflared") {
                continue;
            }
            if !entry.header().entry_type().is_file() || entry.size() > MAX_HELPER {
                bail!("Invalid Bridge helper archive executable");
            }
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o700);
            }
            let mut file = options.open(&temporary)?;
            std::io::copy(&mut entry, &mut file)?;
            file.sync_all()?;
            drop(file);
            let binary = directory.join("cloudflared");
            crate::storage::replace_file(&temporary, &binary)?;
            return Ok(binary);
        }
        bail!("The verified archive did not contain the Bridge executable")
    })();
    let _ = std::fs::remove_file(temporary);
    result
}
pub fn command(binary: &Path, port: u16, config: &Path) -> CommandSpec {
    CommandSpec::new(binary, config.parent().unwrap_or_else(|| Path::new("."))).args(vec![
        "tunnel".into(),
        "--config".into(),
        config.as_os_str().to_owned(),
        "--no-autoupdate".into(),
        "--url".into(),
        format!("http://127.0.0.1:{port}").into(),
    ])
}
pub async fn wait_origin(
    process: &mut ManagedProcess,
    token: &CancellationToken,
) -> Result<String> {
    let deadline = tokio::time::sleep(Duration::from_secs(60));
    tokio::pin!(deadline);
    let mut output = String::new();
    let pattern = regex::Regex::new(r"https://[a-z0-9-]+\.trycloudflare\.com\b")?;
    loop {
        let event = tokio::select! {biased;_=token.cancelled()=>bail!("Bridge startup cancelled."),_=&mut deadline=>bail!("The internet tunnel could not connect. Check your connection and try again."),event=process.next_event()=>event?};
        match event {
            ProcessEvent::Line(_, line) => {
                output.push_str(&line);
                output.push('\n');
                if output.len() > 16000 {
                    output = output
                        .chars()
                        .rev()
                        .take(8000)
                        .collect::<String>()
                        .chars()
                        .rev()
                        .collect();
                }
                if output.contains("Registered tunnel connection") {
                    if let Some(found) = pattern.find(&output) {
                        return Ok(found.as_str().into());
                    }
                }
            }
            ProcessEvent::Exited(_) | ProcessEvent::OutputClosed => {
                bail!("The internet tunnel stopped before connecting. Try again.")
            }
        }
    }
}
pub async fn reachable(origin: &str, token: &CancellationToken) -> bool {
    let operation = async {
        let url = reqwest::Url::parse(origin)?;
        let hostname = url.host_str().context("Missing tunnel hostname")?;
        let mut builder = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .hickory_dns(true)
            .redirect(reqwest::redirect::Policy::none());
        let resolver = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()?;
        if let Ok(response) = resolver
            .get("https://cloudflare-dns.com/dns-query")
            .query(&[("name", hostname), ("type", "A")])
            .header("accept", "application/dns-json")
            .send()
            .await
        {
            if response.status().is_success() {
                if let Ok(data) = response.json::<Value>().await {
                    if let Some(ip) = data["Answer"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|answer| answer["type"] == 1)
                        .filter_map(|answer| answer["data"].as_str())
                        .find_map(|ip| ip.parse::<IpAddr>().ok())
                        .filter(IpAddr::is_ipv4)
                    {
                        builder = builder.resolve(hostname, SocketAddr::new(ip, 443));
                    }
                }
            }
        }
        let response = builder
            .build()?
            .get(url.join("/bridge/session")?)
            .send()
            .await?;
        if response.status() != reqwest::StatusCode::UNAUTHORIZED {
            return Ok(false);
        }
        let mut stream = response.bytes_stream();
        let mut body = Vec::new();
        while let Some(bytes) = stream.next().await {
            let bytes = bytes?;
            if body.len() + bytes.len() > 4096 {
                return Ok(false);
            }
            body.extend(bytes);
        }
        Ok::<_, anyhow::Error>(
            serde_json::from_slice::<Value>(&body).is_ok_and(|body| body["status"] == "expired"),
        )
    };
    tokio::select! {biased;_=token.cancelled()=>false,result=operation=>result.unwrap_or(false)}
}
use futures_util::StreamExt;

#[cfg(test)]
mod checks {
    use super::*;
    use axum::{body::Bytes, routing::get, Router};
    use std::sync::atomic::AtomicUsize;
    async fn source(bytes: Vec<u8>) -> (String, tokio::task::JoinHandle<()>, Arc<AtomicUsize>) {
        let count = Arc::new(AtomicUsize::new(0));
        let calls = count.clone();
        let bytes = Bytes::from(bytes);
        let app = Router::new().route(
            "/helper",
            get(move || {
                let bytes = bytes.clone();
                let calls = calls.clone();
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    bytes
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/helper", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (url, task, count)
    }
    #[tokio::test]
    async fn helper_cache_is_hash_checked_and_modified_binaries_are_downloaded_again() {
        let directory = tempfile::tempdir().unwrap();
        let bytes = b"fixture verified helper".to_vec();
        let hash = format!("{:x}", Sha256::digest(&bytes));
        let (url, server, calls) = source(bytes.clone()).await;
        let asset = Asset {
            version: "fixture".into(),
            platform: "win32-x64".into(),
            name: "helper.exe".into(),
            sha256: hash,
        };
        let token = CancellationToken::new();
        let path = install_from(directory.path(), &asset, &url, &token)
            .await
            .unwrap();
        assert_eq!(tokio::fs::read(&path).await.unwrap(), bytes);
        install_from(directory.path(), &asset, &url, &token)
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        tokio::fs::write(&path, b"modified").await.unwrap();
        install_from(directory.path(), &asset, &url, &token)
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(tokio::fs::read(path).await.unwrap(), bytes);
        server.abort();
    }
    #[tokio::test]
    async fn verified_archives_extract_only_the_helper_and_repair_modified_extracted_files_offline()
    {
        let mut compressed =
            flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        {
            let mut archive = tar::Builder::new(&mut compressed);
            for (name, bytes) in [
                ("cloudflared", b"fixture executable".as_slice()),
                ("unrelated", b"ignored"),
            ] {
                let mut header = tar::Header::new_gnu();
                header.set_size(bytes.len() as u64);
                header.set_mode(0o700);
                header.set_cksum();
                archive.append_data(&mut header, name, bytes).unwrap();
            }
            archive.finish().unwrap();
        }
        let bytes = compressed.finish().unwrap();
        let hash = format!("{:x}", Sha256::digest(&bytes));
        let (url, server, _) = source(bytes).await;
        let asset = Asset {
            version: "fixture".into(),
            platform: "darwin-arm64".into(),
            name: "helper.tgz".into(),
            sha256: hash,
        };
        let directory = tempfile::tempdir().unwrap();
        let token = CancellationToken::new();
        let path = install_from(directory.path(), &asset, &url, &token)
            .await
            .unwrap();
        assert_eq!(tokio::fs::read(&path).await.unwrap(), b"fixture executable");
        assert!(!path.parent().unwrap().join("unrelated").exists());
        server.abort();
        tokio::fs::write(&path, b"modified").await.unwrap();
        let path = install_from(directory.path(), &asset, &url, &token)
            .await
            .unwrap();
        assert_eq!(tokio::fs::read(path).await.unwrap(), b"fixture executable");
    }
    #[tokio::test]
    #[ignore = "Downloads the pinned public Cloudflare helper; never opens a public tunnel"]
    async fn real_pinned_helper_reports_its_expected_version_without_opening_a_tunnel() {
        let directory = tempfile::tempdir().unwrap();
        let token = CancellationToken::new();
        let binary = install(directory.path(), &token).await.unwrap();
        let output = tokio::time::timeout(
            Duration::from_secs(15),
            ManagedProcess::run(
                &CommandSpec::new(binary, directory.path()).args(["--version"]),
                &token,
                |_, _| {},
            ),
        )
        .await
        .unwrap()
        .unwrap();
        output.ensure_success().unwrap();
        let expected = asset(crate::setup_install::platform(), std::env::consts::ARCH)
            .unwrap()
            .version;
        assert!(format!("{}{}", output.stdout, output.stderr).contains(&expected));
    }
}
