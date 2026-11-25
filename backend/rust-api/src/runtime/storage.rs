//! Transactional model-folder moves. Copy and verify before publishing; commit
//! preferences before removing the original. A journal rolls back interrupted
//! publication, while committed cleanup is retried on the next startup.
use crate::engine_runtime::ConfigStore;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{self, BufRead, BufReader, Write},
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
pub(crate) fn file_contents_equal(
    from: &Path,
    to: &Path,
    buffer_capacity: usize,
) -> io::Result<bool> {
    let mut from = BufReader::with_capacity(buffer_capacity, fs::File::open(from)?);
    let mut to = BufReader::with_capacity(buffer_capacity, fs::File::open(to)?);
    loop {
        let left = from.fill_buf()?;
        let right = to.fill_buf()?;
        let count = left.len().min(right.len());
        if count == 0 {
            return Ok(left.is_empty() && right.is_empty());
        }
        if left[..count] != right[..count] {
            return Ok(false);
        }
        from.consume(count);
        to.consume(count);
    }
}

const MODEL_COMPARE_BUFFER: usize = 128 * 1024;
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
    source: PathBuf,
    physical: &'a Path,
    destination: &'a Path,
    data: &'a Path,
}
impl Relocation<'_> {
    fn path(&self, value: &str) -> Result<String> {
        let path = absolute(&self.data.join(value))?;
        for root in [self.physical, &self.source] {
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
        let mut moved = String::with_capacity(text.len());
        for (line_index, line) in text.split('\n').enumerate() {
            if line_index > 0 {
                moved.push('\n');
            }
            for (field, value) in line
                .strip_suffix('\r')
                .unwrap_or(line)
                .split('|')
                .enumerate()
            {
                if field > 0 {
                    moved.push('|');
                }
                if field < 4 && !value.is_empty() {
                    moved.push_str(&self.path(value)?);
                } else {
                    moved.push_str(value);
                }
            }
        }
        Ok(moved)
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
                entry.metadata()?.len() == other.len()
                    && file_contents_equal(&from, &to, MODEL_COMPARE_BUFFER)?
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
                    || entry.metadata()?.len() != other.len()
                    || !file_contents_equal(&from, &to, MODEL_COMPARE_BUFFER)?
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
                source: absolute(source)?,
                physical: &from,
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
            source: absolute(source)?,
            physical: &from,
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
mod tests {
    use super::*;

    #[test]
    fn model_move_verifies_equal_contents_and_relocates_training_paths() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path();
        let source = data.join("logs");
        let destination = data.join("relocated");
        let journal = data.join("journal.json");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&destination).unwrap();
        let checkpoint = vec![7; MODEL_COMPARE_BUFFER + 17];
        fs::write(source.join("voice.pth"), &checkpoint).unwrap();
        fs::write(destination.join("voice.pth"), &checkpoint).unwrap();
        fs::write(destination.join("extra.index"), b"index").unwrap();
        let filelist = "logs/voice.pth||external|logs/voice.pth|logs/keep-as-metadata\r\n";
        fs::write(source.join("filelist.txt"), filelist).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(source.join("voice.pth"), source.join("voice-link")).unwrap();

        move_directory(&source, &destination, data, &journal, || Ok(())).unwrap();
        assert!(!journal.exists());
        assert_eq!(fs::read(destination.join("voice.pth")).unwrap(), checkpoint);
        assert_eq!(fs::read(destination.join("extra.index")).unwrap(), b"index");
        let moved = destination
            .join("voice.pth")
            .to_string_lossy()
            .replace('\\', "/");
        assert_eq!(
            fs::read_to_string(destination.join("filelist.txt")).unwrap(),
            format!("{moved}||external|{moved}|logs/keep-as-metadata\n")
        );
        #[cfg(unix)]
        assert_eq!(
            fs::read_link(destination.join("voice-link")).unwrap(),
            destination.join("voice.pth")
        );

        let mut changed = checkpoint.clone();
        *changed.last_mut().unwrap() = 6;
        fs::write(destination.join("voice.pth"), changed).unwrap();
        assert!(cleanup(&source, &destination, data).is_err());
        assert_eq!(fs::read(source.join("voice.pth")).unwrap(), checkpoint);
        fs::write(destination.join("voice.pth"), &checkpoint).unwrap();
        cleanup(&source, &destination, data).unwrap();
        assert!(!source.exists());
    }

    #[test]
    fn model_move_rolls_back_a_conflict_or_failed_preferences_write() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path();
        let source = data.join("logs");
        let destination = data.join("relocated");
        let journal = data.join("journal.json");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&destination).unwrap();
        fs::write(source.join("voice.pth"), b"source").unwrap();
        fs::write(destination.join("voice.pth"), b"target").unwrap();
        fs::write(destination.join("extra.index"), b"index").unwrap();

        let error = move_directory(&source, &destination, data, &journal, || {
            panic!("preferences cannot be committed when the destination conflicts");
        })
        .unwrap_err();
        assert!(error
            .to_string()
            .contains("Destination contains a conflicting file"));
        assert!(!journal.exists());
        assert_eq!(fs::read(destination.join("voice.pth")).unwrap(), b"target");
        assert_eq!(fs::read(source.join("voice.pth")).unwrap(), b"source");

        fs::remove_file(destination.join("voice.pth")).unwrap();
        let error = move_directory(&source, &destination, data, &journal, || {
            bail!("injected preferences write failure");
        })
        .unwrap_err();
        assert_eq!(error.to_string(), "injected preferences write failure");
        assert!(!journal.exists());
        assert!(!destination.join("voice.pth").exists());
        assert_eq!(fs::read(destination.join("extra.index")).unwrap(), b"index");
        assert_eq!(fs::read(source.join("voice.pth")).unwrap(), b"source");
    }
}
