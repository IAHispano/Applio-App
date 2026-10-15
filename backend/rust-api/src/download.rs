//! Resumable, cancellation-aware downloads. A destination is published only after
//! validating the complete transfer; failed transfers leave the old file intact.
use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use reqwest::{header, Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

#[derive(Serialize, Deserialize)]
struct Metadata {
    url: String,
    validator: String,
}
static TARGETS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
struct Target(Vec<PathBuf>);
impl Drop for Target {
    fn drop(&mut self) {
        let mut targets = TARGETS.get().unwrap().lock().unwrap();
        for path in &self.0 {
            targets.remove(path);
        }
    }
}
pub fn http_url(value: &str) -> Result<Url> {
    let url = Url::parse(value)?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        bail!("Use an HTTP or HTTPS download URL.");
    }
    Ok(url)
}
pub fn client() -> Result<Client> {
    Ok(Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .build()?)
}
pub async fn file(
    client: &Client,
    url: &str,
    destination: &Path,
    sha256: Option<&str>,
    token: &CancellationToken,
    mut progress: impl FnMut(u64, u64),
    mut retry: impl FnMut(u32),
) -> Result<()> {
    http_url(url)?;
    let parent = destination
        .parent()
        .context("Download has no destination folder")?;
    tokio::fs::create_dir_all(parent).await?;
    let target = tokio::fs::canonicalize(parent)
        .await?
        .join(destination.file_name().context("Missing file name")?);
    let partial = PathBuf::from(format!("{}.part", target.display()));
    let metadata = PathBuf::from(format!("{}.json", partial.display()));
    let keys: Vec<PathBuf> = [&target, &partial, &metadata]
        .into_iter()
        .map(|path| {
            if cfg!(windows) {
                PathBuf::from(path.to_string_lossy().to_lowercase())
            } else {
                path.clone()
            }
        })
        .collect();
    {
        let mut targets = TARGETS.get_or_init(Mutex::default).lock().unwrap();
        if keys.iter().any(|key| targets.contains(key)) {
            bail!("Another download is writing this file.");
        }
        targets.extend(keys.iter().cloned());
    }
    let _target = Target(keys);
    for attempt in 0..4 {
        if token.is_cancelled() {
            bail!("Stopped by user");
        }
        let transfer = Transfer {
            url,
            destination: &target,
            partial: &partial,
            metadata_file: &metadata,
            checksum: sha256,
        };
        let operation = transfer.run(client, token, &mut progress);
        let result = operation.await;
        match result {
            Ok(()) => return Ok(()),
            Err(error) => {
                if token.is_cancelled() {
                    bail!("Stopped by user");
                }
                let permanent = error.downcast_ref::<Permanent>().is_some();
                if attempt == 3 || permanent {
                    return Err(error);
                }
                retry(attempt + 1);
                tokio::select! {
                    biased;
                    _ = token.cancelled() => bail!("Stopped by user"),
                    _ = tokio::time::sleep(Duration::from_millis(250 * (1 << attempt))) => {},
                }
            }
        }
    }
    unreachable!()
}
#[derive(Debug)]
struct Permanent(String);
impl std::fmt::Display for Permanent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for Permanent {}
struct Transfer<'a> {
    url: &'a str,
    destination: &'a Path,
    partial: &'a Path,
    metadata_file: &'a Path,
    checksum: Option<&'a str>,
}
impl Transfer<'_> {
    async fn run(
        &self,
        client: &Client,
        token: &CancellationToken,
        progress: &mut impl FnMut(u64, u64),
    ) -> Result<()> {
        let Self {
            url,
            destination,
            partial,
            metadata_file,
            checksum,
        } = *self;
        for path in [partial, metadata_file] {
            if tokio::fs::symlink_metadata(path)
                .await
                .is_ok_and(|m| !m.is_file() || m.file_type().is_symlink())
            {
                return Err(
                    Permanent("Download staging path is not a regular file.".into()).into(),
                );
            }
        }
        let metadata = tokio::fs::read(metadata_file)
            .await
            .ok()
            .and_then(|data| serde_json::from_slice::<Metadata>(&data).ok());
        let mut offset = if metadata
            .as_ref()
            .is_some_and(|m| m.url == url && !m.validator.is_empty())
        {
            tokio::fs::metadata(partial).await.map_or(0, |m| m.len())
        } else {
            0
        };
        let mut request = client.get(url).header(header::ACCEPT_ENCODING, "identity");
        if offset > 0 {
            request = request
                .header(header::RANGE, format!("bytes={offset}-"))
                .header(header::IF_RANGE, &metadata.as_ref().unwrap().validator);
        }
        let response = tokio::select! {
            biased;
            _ = token.cancelled() => bail!("Stopped by user"),
            response = tokio::time::timeout(Duration::from_secs(60), request.send()) => response.context("Download stalled for 60 seconds")??,
        };
        let status = response.status();
        if !status.is_success() {
            if status == StatusCode::RANGE_NOT_SATISFIABLE {
                let _ = tokio::fs::remove_file(metadata_file).await;
            }
            let message = format!("Download failed ({status}).");
            if status.is_client_error() && !matches!(status.as_u16(), 408 | 416 | 429) {
                return Err(Permanent(message).into());
            }
            bail!(message);
        }
        let headers = response.headers();
        let text = |name: header::HeaderName| {
            headers
                .get(name)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
        };
        if !matches!(text(header::CONTENT_ENCODING), "" | "identity") {
            bail!("Server returned compressed bytes for a model download.");
        }
        let etag = text(header::ETAG);
        let validator = if !etag.is_empty() && !etag.starts_with("W/") {
            etag
        } else {
            text(header::LAST_MODIFIED)
        }
        .to_owned();
        let range = text(header::CONTENT_RANGE)
            .strip_prefix("bytes ")
            .and_then(|v| {
                let (span, total) = v.split_once('/')?;
                let (start, end) = span.split_once('-')?;
                Some((
                    start.parse::<u64>().ok()?,
                    end.parse::<u64>().ok()?,
                    total.parse::<u64>().ok()?,
                ))
            });
        if status == StatusCode::PARTIAL_CONTENT
            && (!range.is_some_and(|(start, end, total)| {
                start == offset && offset > 0 && end >= start && end < total
            }) || metadata.as_ref().is_none_or(|m| m.validator != validator))
        {
            let _ = tokio::fs::remove_file(metadata_file).await;
            bail!("Server returned an invalid resume range.");
        }
        if status != StatusCode::PARTIAL_CONTENT {
            offset = 0;
        }
        let length = response.content_length().unwrap_or(0);
        let total = if status == StatusCode::PARTIAL_CONTENT {
            range.unwrap().2
        } else {
            length
        };
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(offset > 0)
            .truncate(offset == 0)
            .open(partial)
            .await?;
        tokio::fs::write(
            metadata_file,
            serde_json::to_vec(&Metadata {
                url: url.into(),
                validator,
            })?,
        )
        .await?;
        let mut received = offset;
        progress(received, total);
        let mut stream = response.bytes_stream();
        loop {
            let bytes = tokio::select! {
                biased;
                _ = token.cancelled() => bail!("Stopped by user"),
                bytes = tokio::time::timeout(Duration::from_secs(60), stream.next()) => bytes.context("Download stalled for 60 seconds")?,
            };
            let Some(bytes) = bytes else {
                break;
            };
            let bytes = bytes?;
            file.write_all(&bytes).await?;
            // Complete buffered file IO before honoring cancellation or releasing the
            // destination lock. A resumed job must see exactly the committed offset.
            file.flush().await?;
            received += bytes.len() as u64;
            progress(received, total);
        }
        if received == 0
            || (total > 0 && received != total)
            || (length > 0 && received - offset != length)
        {
            bail!("Incomplete download; retrying the remaining bytes.");
        }
        file.sync_all().await?;
        drop(file);
        if let Some(expected) = checksum {
            let mut file = tokio::fs::File::open(partial).await?;
            let mut buffer = vec![0; 128 * 1024];
            let mut hash = Sha256::new();
            loop {
                if token.is_cancelled() {
                    bail!("Stopped by user");
                }
                let n = file.read(&mut buffer).await?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
            }
            if format!("{:x}", hash.finalize()) != expected.to_ascii_lowercase() {
                let _ = tokio::fs::remove_file(metadata_file).await;
                bail!("Downloaded file checksum does not match.");
            }
        }
        if token.is_cancelled() {
            bail!("Stopped by user");
        }
        tokio::fs::rename(partial, destination).await?;
        let _ = tokio::fs::remove_file(metadata_file).await;
        Ok(())
    }
}
