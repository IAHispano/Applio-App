//! Transactional model-folder moves. Copy and verify before publishing; commit
//! preferences before removing the original. A journal rolls back interrupted
//! publication, while committed cleanup is retried on the next startup.
use crate::engine_runtime::ConfigStore;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

pub fn absolute(path: &Path) -> Result<PathBuf> {
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    #[cfg(windows)]
    let path = {
        let value = path.to_string_lossy();
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            PathBuf::from(format!(r"\\{rest}"))
        } else if let Some(rest) = value.strip_prefix(r"\\?\") {
            PathBuf::from(rest)
        } else {
            path
        }
    };
    let mut result = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                result.pop();
            }
            part => result.push(part.as_os_str()),
        }
    }
    Ok(result)
}
fn physical(path: &Path) -> Result<PathBuf> {
    let path = absolute(path)?;
    let mut parent = path.as_path();
    let mut tail = Vec::new();
    while !parent.exists() {
        tail.push(
            parent
                .file_name()
                .context("Storage path has no existing parent")?
                .to_owned(),
        );
        parent = parent.parent().context("Storage path has no parent")?;
    }
    let mut resolved = absolute(&fs::canonicalize(parent)?)?;
    for name in tail.into_iter().rev() {
        resolved.push(name);
    }
    Ok(resolved)
}
/// Windows readers and file scanners can briefly deny rename/delete sharing.
/// Retry the atomic replacement without ever removing the old destination.
pub(crate) fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    let mut delay = 10;
    for attempt in 0..12 {
        match fs::rename(source, destination) {
            Err(error)
                if cfg!(windows)
                    && matches!(error.raw_os_error(), Some(5 | 32 | 33))
                    && attempt < 11 =>
            {
                std::thread::sleep(std::time::Duration::from_millis(delay));
                delay = (delay * 2).min(250);
            }
            result => return result,
        }
    }
    unreachable!()
}
pub fn atomic_json(path: &Path, value: &Value) -> Result<()> {
    let parent = path.parent().context("File has no parent")?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".applio-json-{}.tmp", Uuid::new_v4()));
    let result = (|| -> Result<()> {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(&serde_json::to_vec_pretty(value)?)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        drop(file);
        replace_file(&temporary, path)?;
        Ok(())
    })();
    let _ = fs::remove_file(temporary);
    result
}
pub fn validate_logs_dir(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    if !Path::new(value).is_absolute() || value.contains('\0') {
        bail!("Logs folder must be an absolute path.");
    }
    let path = absolute(Path::new(value))?;
    fs::create_dir_all(&path)?;
    let probe = path.join(format!(".applio-write-test-{}", Uuid::new_v4()));
    let result = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe);
    let _ = fs::remove_file(probe);
    result?;
    Ok(path.to_string_lossy().into_owned())
}
pub fn validate_move(source: &Path, destination: &Path) -> Result<()> {
    for folder in [source, destination] {
        if folder.exists() && !folder.is_dir() {
            bail!("Not a logs folder: {}", folder.display());
        }
    }
    let from = physical(source)?;
    let to = physical(destination)?;
    if from == to {
        return Ok(());
    }
    if from.parent().is_none()
        || to.parent().is_none()
        || from.starts_with(&to)
        || to.starts_with(&from)
    {
        bail!("Choose a separate logs folder, outside the current folder and its parent folders.");
    }
    if fs::symlink_metadata(destination).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        bail!("The destination must be a folder, not a symbolic link.");
    }
    Ok(())
}
fn digest(path: &Path) -> Result<Vec<u8>> {
    let mut file = fs::File::open(path)?;
    let mut buffer = vec![0; 1024 * 1024];
    let mut digest = Sha256::new();
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(digest.finalize().to_vec())
}
fn link(source: &Path, target: &Path, destination: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        let _ = source;
        std::os::unix::fs::symlink(target, destination)?;
    }
    #[cfg(windows)]
    {
        if junction::exists(source).unwrap_or(false) {
            junction::create(target, destination)?;
        } else if source.is_dir() {
            std::os::windows::fs::symlink_dir(target, destination)?;
        } else {
            std::os::windows::fs::symlink_file(target, destination)?;
        }
    }
    Ok(())
}
fn copy(source: &Path, destination: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(source)?;
    if metadata.file_type().is_symlink() {
        return link(source, &fs::read_link(source)?, destination);
    }
    if metadata.is_dir() {
        fs::create_dir_all(destination)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy(&entry.path(), &destination.join(entry.file_name()))?;
        }
    } else if metadata.is_file() {
        fs::copy(source, destination)?;
    } else {
        bail!("Unsupported file in models folder: {}", source.display());
    }
    Ok(())
}
struct Relocation<'a> {
    source: &'a Path,
    physical: PathBuf,
    destination: &'a Path,
    data: &'a Path,
}
impl Relocation<'_> {
    fn path(&self, value: &str) -> Result<String> {
        let path = absolute(&self.data.join(value))?;
        for root in [&self.physical, &absolute(self.source)?] {
            if let Ok(relative) = path.strip_prefix(root) {
                return Ok(self
                    .destination
                    .join(relative)
                    .to_string_lossy()
                    .replace('\\', "/"));
            }
        }
        Ok(value.into())
    }
    fn text(&self, text: &str) -> Result<String> {
        text.split('\n')
            .map(|line| {
                line.strip_suffix('\r')
                    .unwrap_or(line)
                    .split('|')
                    .enumerate()
                    .map(|(number, value)| {
                        if number < 4 && !value.is_empty() {
                            self.path(value)
                        } else {
                            Ok(value.into())
                        }
                    })
                    .collect::<Result<Vec<_>>>()
                    .map(|fields| fields.join("|"))
            })
            .collect::<Result<Vec<_>>>()
            .map(|lines| lines.join("\n"))
    }
}
fn same_link(actual: &Path, expected: &Path) -> Result<bool> {
    if expected.is_absolute() && actual.is_absolute() {
        Ok(absolute(actual)? == absolute(expected)?)
    } else {
        Ok(actual == expected)
    }
}
fn verify(source: &Path, destination: &Path, relocation: Option<&Relocation<'_>>) -> Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let from = entry.path();
        let to = destination.join(entry.file_name());
        let kind = entry.file_type()?;
        let other = fs::symlink_metadata(&to)
            .with_context(|| format!("Could not verify copied file: {}", from.display()))?;
        let matches = if kind.is_dir() && other.is_dir() && !other.file_type().is_symlink() {
            verify(&from, &to, relocation)?;
            true
        } else if kind.is_symlink() && other.file_type().is_symlink() {
            let target = fs::read_link(&from)?;
            let expected = if let Some(relocation) = relocation.filter(|_| target.is_absolute()) {
                PathBuf::from(relocation.path(&target.to_string_lossy())?)
            } else {
                target
            };
            same_link(&fs::read_link(&to)?, &expected)?
        } else if kind.is_file() && other.is_file() && !other.file_type().is_symlink() {
            if let Some(relocation) = relocation.filter(|_| entry.file_name() == "filelist.txt") {
                relocation.text(&fs::read_to_string(&from)?)? == fs::read_to_string(&to)?
            } else {
                entry.metadata()?.len() == other.len() && digest(&from)? == digest(&to)?
            }
        } else {
            false
        };
        if !matches {
            bail!("Could not verify copied file: {}", from.display());
        }
    }
    Ok(())
}
fn merge(source: &Path, destination: &Path) -> Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let from = entry.path();
        let to = destination.join(entry.file_name());
        match fs::symlink_metadata(&to) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => copy(&from, &to)?,
            Err(error) => return Err(error.into()),
            Ok(other) => {
                let kind = entry.file_type()?;
                if kind.is_dir() && other.is_dir() && !other.file_type().is_symlink() {
                    merge(&from, &to)?;
                } else if !kind.is_file()
                    || !other.is_file()
                    || other.file_type().is_symlink()
                    || digest(&from)? != digest(&to)?
                {
                    bail!(
                        "Destination contains a conflicting file: {}",
                        from.display()
                    );
                }
            }
        }
    }
    Ok(())
}
fn relocate(directory: &Path, paths: &Relocation<'_>) -> Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let file = entry.path();
        let kind = entry.file_type()?;
        if kind.is_dir() {
            relocate(&file, paths)?;
        } else if kind.is_file() && entry.file_name() == "filelist.txt" {
            fs::write(&file, paths.text(&fs::read_to_string(&file)?)?)?;
        } else if kind.is_symlink() {
            let target = fs::read_link(&file)?;
            if target.is_absolute() {
                let moved = PathBuf::from(paths.path(&target.to_string_lossy())?);
                if !same_link(&target, &moved)? {
                    // Preserve the link kind before removing the staged link.
                    #[cfg(windows)]
                    let directory_link = junction::exists(&file).unwrap_or(false) || file.is_dir();
                    remove_link(&file)?;
                    #[cfg(unix)]
                    {
                        std::os::unix::fs::symlink(moved, &file)?;
                    }
                    #[cfg(windows)]
                    {
                        if directory_link {
                            junction::create(moved, &file)?;
                        } else {
                            std::os::windows::fs::symlink_file(moved, &file)?;
                        }
                    }
                }
            }
        }
    }
    Ok(())
}
fn remove_link(path: &Path) -> Result<()> {
    #[cfg(windows)]
    if junction::exists(path).unwrap_or(false) {
        junction::delete(path)?;
        fs::remove_dir(path)?;
        return Ok(());
    }
    #[cfg(unix)]
    fs::remove_file(path)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if fs::symlink_metadata(path)?.file_attributes() & 0x10 != 0 {
            fs::remove_dir(path)?;
        } else {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}
fn remove_tree(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
        Ok(metadata) if metadata.file_type().is_symlink() => remove_link(path),
        Ok(metadata) if metadata.is_dir() => {
            fs::remove_dir_all(path)?;
            Ok(())
        }
        Ok(_) => {
            fs::remove_file(path)?;
            Ok(())
        }
    }
}
#[derive(Serialize, Deserialize)]
struct Journal {
    source: PathBuf,
    destination: PathBuf,
    stage: PathBuf,
    backup: PathBuf,
    prepared: bool,
    #[serde(default)]
    had_destination: bool,
}
impl Journal {
    fn check(&self) -> Result<()> {
        validate_move(&self.source, &self.destination)?;
        for path in [&self.stage, &self.backup] {
            if absolute(path)? == absolute(&self.source)?
                || absolute(path)? == absolute(&self.destination)?
            {
                bail!("Invalid migration staging path");
            }
        }
        let parent = self
            .destination
            .parent()
            .context("Invalid models destination")?;
        for (path, prefix) in [
            (&self.stage, ".applio-logs-move-"),
            (&self.backup, ".applio-logs-backup-"),
        ] {
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .context("Invalid migration staging path")?;
            let id = name
                .strip_prefix(prefix)
                .context("Invalid migration staging path")?;
            Uuid::parse_str(id)?;
            if absolute(path.parent().context("Invalid migration staging path")?)?
                != absolute(parent)?
            {
                bail!("Invalid migration staging path");
            }
        }
        Ok(())
    }
}
fn recover(journal_file: &Path, committed: bool) -> Result<()> {
    let journal: Journal = serde_json::from_slice(&fs::read(journal_file)?)?;
    journal.check()?;
    if !committed && journal.prepared {
        if journal.backup.exists() {
            if journal.destination.exists() {
                if journal.stage.exists() {
                    bail!(
                        "Models migration recovery needs both staged copies; originals were kept"
                    );
                }
                fs::rename(&journal.destination, &journal.stage)?;
            }
            fs::rename(&journal.backup, &journal.destination)?;
        } else if !journal.had_destination
            && !journal.stage.exists()
            && journal.destination.exists()
        {
            fs::rename(&journal.destination, &journal.stage)?;
        }
    }
    remove_tree(&journal.stage)?;
    if committed {
        remove_tree(&journal.backup)?;
    }
    fs::remove_file(journal_file)?;
    Ok(())
}
fn move_directory(
    source: &Path,
    destination: &Path,
    data: &Path,
    journal_file: &Path,
    commit: impl FnOnce() -> Result<()>,
) -> Result<()> {
    validate_move(source, destination)?;
    if !source.exists() || physical(source)? == physical(destination)? {
        fs::create_dir_all(destination)?;
        return commit();
    }
    let parent = destination
        .parent()
        .context("Models destination has no parent")?;
    fs::create_dir_all(parent)?;
    let mut journal = Journal {
        source: source.into(),
        destination: destination.into(),
        stage: parent.join(format!(".applio-logs-move-{}", Uuid::new_v4())),
        backup: parent.join(format!(".applio-logs-backup-{}", Uuid::new_v4())),
        prepared: false,
        had_destination: destination.exists(),
    };
    journal.check()?;
    atomic_json(journal_file, &serde_json::to_value(&journal)?)?;
    let result = (|| -> Result<()> {
        let from = physical(source)?;
        copy(&from, &journal.stage)?;
        verify(&from, &journal.stage, None)?;
        if destination.exists() {
            merge(destination, &journal.stage)?;
        }
        relocate(
            &journal.stage,
            &Relocation {
                source,
                physical: physical(source)?,
                destination,
                data,
            },
        )?;
        journal.prepared = true;
        atomic_json(journal_file, &serde_json::to_value(&journal)?)?;
        if destination.exists() {
            fs::rename(destination, &journal.backup)?;
        }
        fs::rename(&journal.stage, destination)?;
        commit()
    })();
    match result {
        Ok(()) => recover(journal_file, true),
        Err(error) => {
            recover(journal_file, false)
                .with_context(|| format!("Models move failed: {error:#}; rollback failed"))?;
            Err(error)
        }
    }
}
fn cleanup(source: &Path, destination: &Path, data: &Path) -> Result<()> {
    validate_move(source, destination)?;
    if !destination.is_dir() {
        bail!("The new logs folder is missing; the original files were kept.");
    }
    match fs::symlink_metadata(source) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
        Ok(metadata) if metadata.file_type().is_symlink() && !source.exists() => {
            return remove_link(source)
        }
        _ => {}
    }
    let from = physical(source)?;
    let to = physical(destination)?;
    if from == to {
        return Ok(());
    }
    verify(
        &from,
        &to,
        Some(&Relocation {
            source,
            physical: from.clone(),
            destination,
            data,
        }),
    )?;
    // Both canonical roots have been checked for overlap, drive roots and full
    // copied content. A failed verification leaves the original intact.
    remove_tree(&from)?;
    if fs::symlink_metadata(source).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        remove_link(source)?;
    }
    Ok(())
}
pub fn initialize(
    config: &ConfigStore,
    data: &Path,
    config_dir: &Path,
) -> Result<(PathBuf, Option<String>)> {
    let preferences = config.load()?;
    let destination = absolute(
        &preferences["logs_dir"]
            .as_str()
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| data.join("logs")),
    )?;
    let journal_file = config_dir.join("logs-move.json");
    let result = (|| -> Result<()> {
        if journal_file.exists() {
            let journal: Journal = serde_json::from_slice(&fs::read(&journal_file)?)?;
            let committed = preferences["logs_move_from"]
                .as_str()
                .unwrap_or_default()
                .is_empty()
                && physical(&journal.destination)? == physical(&destination)?;
            recover(&journal_file, committed)?;
        }
        let source = preferences["logs_move_from"]
            .as_str()
            .filter(|source| !source.is_empty());
        if let Some(source) = source {
            move_directory(Path::new(source), &destination, data, &journal_file, || {
                config
                    .modify(|value| {
                        value["logs_move_from"] = json!("");
                        value["logs_cleanup_from"] = json!(source);
                        Ok(())
                    })
                    .map(|_| ())
            })?;
        }
        let next = config.load()?;
        if let Some(source) = next["logs_cleanup_from"]
            .as_str()
            .filter(|source| !source.is_empty())
        {
            cleanup(Path::new(source), &destination, data)?;
            config.modify(|value| {
                value.as_object_mut().unwrap().remove("logs_cleanup_from");
                Ok(())
            })?;
        }
        Ok(())
    })();
    let error = result.err().map(|error| format!("{error:#}"));
    let pending = config.load()?;
    let active = if error.is_some() {
        pending["logs_move_from"]
            .as_str()
            .filter(|source| !source.is_empty())
            .map(PathBuf::from)
            .unwrap_or(destination)
    } else {
        destination
    };
    Ok((absolute(&active)?, error))
}

#[cfg(test)]
mod checks {
    use super::*;
    #[cfg(windows)]
    #[test]
    fn atomic_json_retries_a_temporary_windows_reader_lock_without_removing_old_data() {
        use std::os::windows::fs::OpenOptionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.json");
        atomic_json(&path, &serde_json::json!({"version":"old"})).unwrap();
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(&path)
            .unwrap();
        let reader = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(700));
            drop(held);
        });
        atomic_json(&path, &serde_json::json!({"version":"new"})).unwrap();
        reader.join().unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(path).unwrap()).unwrap()["version"],
            "new"
        );
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    fn journal(source: &Path, destination: &Path) -> Journal {
        let parent = destination.parent().unwrap();
        Journal {
            source: source.into(),
            destination: destination.into(),
            stage: parent.join(format!(".applio-logs-move-{}", Uuid::new_v4())),
            backup: parent.join(format!(".applio-logs-backup-{}", Uuid::new_v4())),
            prepared: true,
            had_destination: true,
        }
    }
    #[test]
    fn staged_move_preserves_original_until_commit_and_relocates_training_filelists() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("logs");
        let destination = root.path().join("custom logs");
        let record = root.path().join("config/move.json");
        write(&source.join("voice/voice.pth"), "checkpoint");
        write(&destination.join("mute/reference.wav"), "reference");
        let line = format!(
            "{}|logs/voice/audio.wav|outside.wav|{}|7\r\n",
            source.join("voice/features.npy").display(),
            source.join("voice/f0.npy").display()
        );
        write(&source.join("voice/filelist.txt"), &line);
        move_directory(&source, &destination, root.path(), &record, || {
            assert_eq!(
                fs::read_to_string(source.join("voice/voice.pth"))?,
                "checkpoint"
            );
            assert!(destination.join("voice/voice.pth").is_file());
            Ok(())
        })
        .unwrap();
        let paths = Relocation {
            source: &source,
            physical: physical(&source).unwrap(),
            destination: &destination,
            data: root.path(),
        };
        assert_eq!(
            fs::read_to_string(destination.join("voice/filelist.txt")).unwrap(),
            paths.text(&line).unwrap()
        );
        assert!(destination.join("mute/reference.wav").is_file());
        assert!(source.is_dir());
        assert!(!record.exists());
        cleanup(&source, &destination, root.path()).unwrap();
        assert!(!source.exists());
    }
    #[test]
    fn conflicting_destination_and_failed_commit_leave_both_original_trees_untouched() {
        for conflict in [true, false] {
            let root = tempfile::tempdir().unwrap();
            let source = root.path().join("logs");
            let destination = root.path().join("destination");
            let record = root.path().join("move.json");
            write(&source.join("voice.pth"), "original");
            write(
                &destination.join(if conflict { "voice.pth" } else { "other.pth" }),
                "destination",
            );
            assert!(move_directory(
                &source,
                &destination,
                root.path(),
                &record,
                || anyhow::bail!("settings commit failed")
            )
            .is_err());
            assert_eq!(
                fs::read_to_string(source.join("voice.pth")).unwrap(),
                "original"
            );
            assert_eq!(
                fs::read_to_string(destination.join(if conflict {
                    "voice.pth"
                } else {
                    "other.pth"
                }))
                .unwrap(),
                "destination"
            );
            if !conflict {
                assert!(!destination.join("voice.pth").exists());
            }
            assert!(!record.exists());
            assert_eq!(fs::read_dir(root.path()).unwrap().count(), 2);
        }
    }
    #[test]
    fn journal_recovers_interrupted_publish_before_or_after_commit() {
        for committed in [true, false] {
            let root = tempfile::tempdir().unwrap();
            let source = root.path().join("logs");
            let destination = root.path().join("destination");
            let record = root.path().join("move.json");
            let transaction = journal(&source, &destination);
            write(&source.join("source.pth"), "source");
            write(&transaction.backup.join("existing.pth"), "existing");
            write(&destination.join("source.pth"), "published");
            atomic_json(&record, &serde_json::to_value(&transaction).unwrap()).unwrap();
            recover(&record, committed).unwrap();
            assert!(source.join("source.pth").is_file());
            assert!(!transaction.stage.exists());
            assert!(!transaction.backup.exists());
            assert!(!record.exists());
            assert!(destination
                .join(if committed {
                    "source.pth"
                } else {
                    "existing.pth"
                })
                .is_file());
        }
    }

    #[test]
    fn retrying_rollback_does_not_remove_the_restored_destination() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("logs");
        let destination = root.path().join("destination");
        let record = root.path().join("move.json");
        let transaction = journal(&source, &destination);
        write(&source.join("voice.pth"), "original");
        write(&destination.join("existing.pth"), "restored destination");
        atomic_json(&record, &serde_json::to_value(&transaction).unwrap()).unwrap();
        recover(&record, false).unwrap();
        assert_eq!(
            fs::read_to_string(destination.join("existing.pth")).unwrap(),
            "restored destination"
        );
        assert!(source.join("voice.pth").is_file());
    }
    #[test]
    fn cleanup_requires_verified_destination_and_rejects_source_changes() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("logs");
        let destination = root.path().join("destination");
        let record = root.path().join("move.json");
        write(&source.join("voice.pth"), "original");
        move_directory(&source, &destination, root.path(), &record, || Ok(())).unwrap();
        write(&source.join("new.pth"), "new model since commit");
        assert!(cleanup(&source, &destination, root.path()).is_err());
        assert!(source.join("voice.pth").is_file());
        assert!(source.join("new.pth").is_file());
        fs::remove_file(source.join("new.pth")).unwrap();
        write(&destination.join("voice.pth"), "corrupted copy");
        assert!(cleanup(&source, &destination, root.path()).is_err());
        assert!(source.join("voice.pth").is_file());
    }
    #[test]
    fn roots_nested_folders_and_forged_journals_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("logs");
        write(&source.join("voice.pth"), "original");
        assert!(validate_move(&source, &source.join("nested")).is_err());
        assert!(validate_move(&source, root.path()).is_err());
        let destination = root.path().join("destination");
        let mut transaction = journal(&source, &destination);
        transaction.stage = source.clone();
        let record = root.path().join("move.json");
        atomic_json(&record, &serde_json::to_value(transaction).unwrap()).unwrap();
        assert!(recover(&record, false).is_err());
        assert!(source.join("voice.pth").is_file());
        let source = root
            .path()
            .join(format!(".applio-logs-move-{}", Uuid::new_v4()));
        write(&source.join("model.pth"), "original");
        let mut transaction = journal(&source, &destination);
        transaction.stage = source.clone();
        atomic_json(&record, &serde_json::to_value(transaction).unwrap()).unwrap();
        assert!(recover(&record, false).is_err());
        assert!(source.join("model.pth").is_file());
    }
    #[test]
    fn initialize_completes_move_or_keeps_using_original_on_conflict() {
        for conflict in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let code = root.path().join("code");
            let data = root.path().join("data");
            let config_dir = root.path().join("config");
            write(&code.join("assets/config_template.json"), "{}");
            let source = data.join("logs");
            let destination = root.path().join("custom");
            write(&source.join("voice.pth"), "original");
            if conflict {
                write(&destination.join("voice.pth"), "different");
            }
            let config = ConfigStore::open(&crate::ApiConfig {
                code_root: code,
                data_root: data.clone(),
                config_dir: config_dir.clone(),
            })
            .unwrap();
            config
                .update(json!({"logs_dir":destination,"logs_move_from":source}))
                .unwrap();
            let (active, error) = initialize(&config, &data, &config_dir).unwrap();
            if conflict {
                assert_eq!(active, source);
                assert!(error.unwrap().contains("conflicting"));
                assert!(source.join("voice.pth").is_file());
                assert_eq!(config.load().unwrap()["logs_move_from"], json!(source));
            } else {
                assert_eq!(active, destination);
                assert!(error.is_none());
                assert!(!source.exists());
                assert_eq!(config.load().unwrap()["logs_move_from"], "");
                assert!(config.load().unwrap().get("logs_cleanup_from").is_none());
            }
        }
    }
    #[test]
    fn directory_links_are_preserved_and_relocated_without_mutating_originals() {
        let root = tempfile::tempdir().unwrap();
        let physical_source = root.path().join("physical logs");
        let source = root.path().join("logs");
        let destination = root.path().join("destination");
        let record = root.path().join("move.json");
        write(&physical_source.join("voice/data.bin"), "model data");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&physical_source, &source).unwrap();
            std::os::unix::fs::symlink(
                physical_source.join("voice"),
                physical_source.join("voice-link"),
            )
            .unwrap();
        }
        #[cfg(windows)]
        {
            junction::create(&physical_source, &source).unwrap();
            junction::create(
                physical_source.join("voice"),
                physical_source.join("voice-link"),
            )
            .unwrap();
        }
        move_directory(&source, &destination, root.path(), &record, || {
            assert!(source.join("voice/data.bin").is_file());
            Ok(())
        })
        .unwrap();
        assert_eq!(
            physical(&destination.join("voice-link")).unwrap(),
            physical(&destination.join("voice")).unwrap()
        );
        assert_eq!(
            physical(&source.join("voice-link")).unwrap(),
            physical(&physical_source.join("voice")).unwrap()
        );
        cleanup(&source, &destination, root.path()).unwrap();
        assert!(destination.join("voice-link/data.bin").is_file());
        assert!(fs::symlink_metadata(source).is_err());
        assert!(!physical_source.exists());
    }
}
