//! Supervised native processes. A job owns the entire process tree, including
//! Python multiprocessing children. Dropping a job future never leaves workers
//! running or releases its GPU lease before termination has been requested.
use anyhow::{bail, Context, Result};
use std::{collections::BTreeMap, ffi::OsString, path::PathBuf, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStdin, Command},
    sync::mpsc,
};
use tokio_util::sync::CancellationToken;

const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;
const STDOUT_TAIL: usize = 4 * 1024 * 1024;
const STDERR_TAIL: usize = 2 * 1024 * 1024;

pub fn json_result(stdout: &str) -> Result<serde_json::Value> {
    let json = stdout
        .lines()
        .rev()
        .find_map(|line| line.split_once("APPLIO_JSON:").map(|(_, json)| json))
        .context("Python did not report a JSON result")?;
    Ok(serde_json::from_str(json)?)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: PathBuf,
    pub env: BTreeMap<OsString, OsString>,
    pub env_remove: Vec<OsString>,
}
impl CommandSpec {
    pub fn new(program: impl Into<PathBuf>, cwd: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
            cwd: cwd.into(),
            args: Vec::new(),
            env: BTreeMap::new(),
            env_remove: Vec::new(),
        }
    }
    pub fn args(mut self, args: impl IntoIterator<Item = impl Into<OsString>>) -> Self {
        self.args.extend(args.into_iter().map(Into::into));
        self
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Stream {
    Stdout,
    Stderr,
}
#[derive(Debug)]
pub enum OutputEvent {
    Line(Stream, String),
    ReadError(String),
}

pub enum ProcessEvent {
    Line(Stream, String),
    Exited(Option<i32>),
    OutputClosed,
}

pub struct ManagedProcess {
    child: Child,
    stdin: Option<ChildStdin>,
    output: mpsc::Receiver<OutputEvent>,
    tree: ProcessTree,
}

impl ManagedProcess {
    pub fn spawn(spec: &CommandSpec) -> Result<Self> {
        // Resolve an explicit child PATH ourselves. Windows CreateProcess search
        // must not accidentally select a different tool from the host PATH.
        let program = if spec.program.components().count() == 1 {
            spec.env
                .get(std::ffi::OsStr::new("PATH"))
                .and_then(|path| {
                    std::env::split_paths(path).find_map(|directory| {
                        let candidate = directory.join(&spec.program);
                        if candidate.is_file() {
                            return Some(candidate);
                        }
                        if cfg!(windows) && candidate.extension().is_none() {
                            let candidate = candidate.with_extension("exe");
                            if candidate.is_file() {
                                return Some(candidate);
                            }
                        }
                        None
                    })
                })
                .unwrap_or_else(|| spec.program.clone())
        } else {
            spec.program.clone()
        };
        let mut command = Command::new(program);
        command
            .args(&spec.args)
            .current_dir(&spec.cwd)
            .envs(&spec.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for key in &spec.env_remove {
            command.env_remove(key);
        }
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.as_std_mut().process_group(0);
        }
        let mut child = command
            .spawn()
            .with_context(|| format!("Could not start {}", spec.program.display()))?;
        let pid = child.id().context("Process did not receive an ID")?;
        let tree = ProcessTree::new(pid)?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().context("Missing process stdout")?;
        let stderr = child.stderr.take().context("Missing process stderr")?;
        // Bound producer queues. A slow UI or a noisy training subprocess
        // applies backpressure instead of allocating an unbounded log buffer.
        let (sender, output) = mpsc::channel(128);
        tokio::spawn(pump(stdout, Stream::Stdout, sender.clone()));
        tokio::spawn(pump(stderr, Stream::Stderr, sender));
        Ok(Self {
            child,
            stdin,
            output,
            tree,
        })
    }

    pub fn id(&self) -> Option<u32> {
        self.child.id()
    }

    pub async fn send_json(&mut self, value: &serde_json::Value) -> Result<()> {
        let mut bytes = serde_json::to_vec(value)?;
        bytes.push(b'\n');
        let stdin = self.stdin.as_mut().context("Process input is closed")?;
        stdin.write_all(&bytes).await?;
        stdin.flush().await?;
        Ok(())
    }

    pub async fn next_line(&mut self) -> Result<Option<(Stream, String)>> {
        match self.output.recv().await {
            Some(OutputEvent::Line(stream, line)) => Ok(Some((stream, line))),
            Some(OutputEvent::ReadError(error)) => bail!(error),
            None => Ok(None),
        }
    }

    pub async fn next_event(&mut self) -> Result<ProcessEvent> {
        tokio::select! {
            biased;
            event = self.output.recv() => match event {
                Some(OutputEvent::Line(stream, line)) => Ok(ProcessEvent::Line(stream, line)),
                Some(OutputEvent::ReadError(error)) => bail!(error),
                None => Ok(ProcessEvent::OutputClosed),
            },
            status = self.child.wait() => Ok(ProcessEvent::Exited(status?.code())),
        }
    }

    pub fn try_wait(&mut self) -> Result<Option<std::process::ExitStatus>> {
        Ok(self.child.try_wait()?)
    }
    pub async fn wait(&mut self) -> Result<Option<i32>> {
        Ok(self.child.wait().await?.code())
    }

    pub async fn stop(&mut self) -> Result<()> {
        self.stdin.take();
        self.tree.terminate();
        // The group signal only reaches the child when it became the group
        // leader. Signal the interpreter directly as well, so a graceful
        // shutdown starts even where process grouping is unavailable.
        #[cfg(unix)]
        if let Some(pid) = self.child.id() {
            unsafe {
                libc::kill(pid as i32, libc::SIGTERM);
            }
        }
        let result = tokio::time::timeout(Duration::from_secs(5), self.child.wait()).await;
        if result.is_err() {
            self.tree.kill();
            let _ = self.child.kill().await;
        }
        // Descendants may outlive the interpreter even after it has exited.
        self.tree.kill();
        self.child.wait().await?;
        Ok(())
    }

    pub async fn run(
        spec: &CommandSpec,
        cancelled: &CancellationToken,
        mut on_line: impl FnMut(Stream, &str),
    ) -> Result<ProcessOutput> {
        if cancelled.is_cancelled() {
            bail!("Stopped by user");
        }
        let mut process = Self::spawn(spec)?;
        process.stdin.take();
        let mut stdout = String::new();
        let mut stderr = String::new();
        let status;
        loop {
            tokio::select! {
                biased;
                _ = cancelled.cancelled() => {
                    process.stop().await?;
                    bail!("Stopped by user");
                }
                result = process.child.wait() => {
                    status = result?;
                    // Kill descendants before draining output: a detached child
                    // retaining inherited pipes must not hang a completed job.
                    process.tree.kill();
                    break;
                }
                event = process.output.recv() => {
                    match event {
                        Some(OutputEvent::Line(stream, line)) => record(stream, &line, &mut stdout, &mut stderr, &mut on_line),
                        Some(OutputEvent::ReadError(error)) => { process.stop().await?; bail!(error); },
                        None => { status = process.child.wait().await?; process.tree.kill(); break; },
                    }
                }
            }
        }
        while let Some(event) = process.output.recv().await {
            match event {
                OutputEvent::Line(stream, line) => {
                    record(stream, &line, &mut stdout, &mut stderr, &mut on_line)
                }
                OutputEvent::ReadError(error) => bail!(error),
            }
        }
        Ok(ProcessOutput {
            code: status.code(),
            success: status.success(),
            stdout,
            stderr,
        })
    }
}
impl Drop for ManagedProcess {
    fn drop(&mut self) {
        self.tree.kill();
        let _ = self.child.start_kill();
    }
}

#[derive(Clone, Debug)]
pub struct ProcessOutput {
    pub code: Option<i32>,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}
impl ProcessOutput {
    pub fn ensure_success(&self) -> Result<()> {
        if self.success {
            return Ok(());
        }
        let message = if self.stderr.trim().is_empty() {
            format!("Process exited with code {:?}", self.code)
        } else {
            self.stderr
                .chars()
                .rev()
                .take(3000)
                .collect::<String>()
                .chars()
                .rev()
                .collect()
        };
        if let Some(explanation) = explain_exit_code(self.code) {
            bail!("{message}\n{explanation}");
        }
        bail!(message)
    }
}

pub fn explain_exit_code(code: Option<i32>) -> Option<&'static str> {
    match code.map(|value| value as u32) {
        Some(0xc0000005) => Some("Windows Access Violation (0xC0000005) — A process or native GPU library crashed."),
        Some(0xc0000135) => Some("Missing DLL Dependency (0xC0000135) — A required native library was not found in PATH."),
        Some(0xc0000139) => Some("DLL Entry Point Not Found (0xC0000139) — Incompatible native library version."),
        Some(0xc0000409) => Some("Stack Buffer Overrun / Abort (0xC0000409) — Process aborted."),
        Some(139) => Some("Segmentation fault (SIGSEGV / exit code 139)."),
        Some(134) => Some("Process abort (SIGABRT / exit code 134)."),
        _ => None,
    }
}

fn record(
    stream: Stream,
    line: &str,
    stdout: &mut String,
    stderr: &mut String,
    callback: &mut impl FnMut(Stream, &str),
) {
    match stream {
        Stream::Stdout => append_tail(stdout, line, STDOUT_TAIL),
        Stream::Stderr => append_tail(stderr, line, STDERR_TAIL),
    }
    callback(stream, line);
}
fn append_tail(value: &mut String, line: &str, limit: usize) {
    value.push_str(line);
    value.push('\n');
    if value.len() > limit {
        let mut from = value.len() - limit;
        while !value.is_char_boundary(from) {
            from += 1;
        }
        value.drain(..from);
    }
}

async fn pump(
    mut reader: impl AsyncRead + Unpin,
    stream: Stream,
    sender: mpsc::Sender<OutputEvent>,
) {
    let mut chunk = [0_u8; 8192];
    let mut pending = Vec::new();
    let mut scanned = 0;
    loop {
        let size = match reader.read(&mut chunk).await {
            Ok(size) => size,
            Err(error) => {
                let _ = sender.send(OutputEvent::ReadError(error.to_string())).await;
                return;
            }
        };
        if size == 0 {
            if !pending.is_empty() {
                let _ = sender
                    .send(OutputEvent::Line(
                        stream,
                        String::from_utf8_lossy(&pending).into_owned(),
                    ))
                    .await;
            }
            return;
        }
        pending.extend_from_slice(&chunk[..size]);
        let mut start = 0;
        for (index, byte) in pending.iter().enumerate().skip(scanned) {
            if *byte == b'\r' || *byte == b'\n' {
                if index - start > MAX_LINE_BYTES {
                    let _ = sender
                        .send(OutputEvent::ReadError(
                            "Engine output line exceeds 16 MB".into(),
                        ))
                        .await;
                    return;
                }
                if start != index
                    && sender
                        .send(OutputEvent::Line(
                            stream,
                            String::from_utf8_lossy(&pending[start..index]).into_owned(),
                        ))
                        .await
                        .is_err()
                {
                    return;
                }
                start = index + 1;
            }
        }
        if start > 0 {
            pending.drain(..start);
        }
        // The retained prefix has no delimiters. Inspect only newly read
        // bytes next time, instead of rescanning a growing JSON protocol line.
        scanned = pending.len();
        if pending.len() > MAX_LINE_BYTES {
            let _ = sender
                .send(OutputEvent::ReadError(
                    "Engine output line exceeds 16 MB".into(),
                ))
                .await;
            return;
        }
    }
}

#[cfg(windows)]
struct ProcessTree(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
unsafe impl Send for ProcessTree {}
#[cfg(windows)]
impl ProcessTree {
    fn new(pid: u32) -> Result<Self> {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::{
                JobObjects::*,
                Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
            },
        };
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(std::io::Error::last_os_error().into());
            }
            let tree = Self(handle);
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
            {
                return Err(std::io::Error::last_os_error().into());
            }
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if process.is_null() {
                return Err(std::io::Error::last_os_error().into());
            }
            let assigned = AssignProcessToJobObject(handle, process);
            let error = std::io::Error::last_os_error();
            CloseHandle(process);
            if assigned == 0 {
                return Err(error.into());
            }
            Ok(tree)
        }
    }
    fn terminate(&self) {
        self.kill();
    }
    fn kill(&self) {
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0, 1);
        }
    }
}
#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(unix)]
struct ProcessTree(i32);
#[cfg(unix)]
impl ProcessTree {
    fn new(pid: u32) -> Result<Self> {
        Ok(Self(pid as i32))
    }
    fn terminate(&self) {
        unsafe {
            libc::kill(-self.0, libc::SIGTERM);
        }
    }
    fn kill(&self) {
        unsafe {
            libc::kill(-self.0, libc::SIGKILL);
        }
    }
}
#[cfg(unix)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        self.kill();
    }
}

/// Whether another process is still alive. Used to recognize leftovers from a
/// previous run; recycled pids are rejected by [`process_name`] before
/// anything is signaled.
#[cfg(unix)]
pub fn process_alive(pid: u32) -> bool {
    unsafe {
        if libc::kill(pid as i32, 0) == 0 {
            return true;
        }
    }
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}
#[cfg(not(unix))]
pub fn process_alive(_pid: u32) -> bool {
    false
}

/// Best-effort executable name of another process, or `None` when the platform
/// cannot report it. On macOS `proc_pidpath` resolves the real interpreter, so
/// a Python leftover is recognizable even behind a virtual environment.
#[cfg(target_os = "macos")]
pub fn process_name(pid: u32) -> Option<String> {
    let mut buffer = [0_u8; 4096];
    let size =
        unsafe { libc::proc_pidpath(pid as i32, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
    if size <= 0 {
        return None;
    }
    let path = std::str::from_utf8(&buffer[..size as usize]).ok()?;
    Some(path.rsplit('/').next()?.to_string())
}
#[cfg(all(unix, not(target_os = "macos")))]
pub fn process_name(pid: u32) -> Option<String> {
    std::fs::read_to_string(format!("/proc/{pid}/comm"))
        .ok()
        .map(|name| name.trim().to_string())
}
#[cfg(not(unix))]
pub fn process_name(_pid: u32) -> Option<String> {
    None
}

/// Signal a leftover process group and its direct child: the group covers
/// descendants such as worker subprocesses, the direct pid covers platforms
/// where the group was never established.
#[cfg(unix)]
pub fn signal_process(pid: u32, force: bool) {
    let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
    unsafe {
        libc::kill(-(pid as i32), signal);
        libc::kill(pid as i32, signal);
    }
}
#[cfg(not(unix))]
pub fn signal_process(_pid: u32, _force: bool) {}
