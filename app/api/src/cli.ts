import { spawn } from "node:child_process";
import { errMsg } from "@/errors";
import { appendLog, createJob, getJob, type Job, type JobType, setDone, setError, setRunning } from "@/jobs";
import { repoRel as sharedRepoRel } from "@/lib/fsutils";
import { runPythonModule } from "@/python";

const jobPids = new Map<string, number>();
const jobGroups = new Set<string>();
const useGroupKill = () => process.platform !== "win32";

// Terminal noise (tqdm bars) vs. load-bearing status lines.
// tqdm redraws arrive as many `\r`-separated fragments per second; keeping
// every one floods the 500-entry job log and evicts the `epoch=` lines the
// training console parses for Epoch Progress. Throttle noise, always keep
// status lines (epoch/step/save/markers/errors) so progress never stalls.
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI ESC prefix is required to strip terminal codes
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const TQDM_NOISE_RE = /(\d{1,3})%\s*\|/;
const IMPORTANT_LINE_RE =
  /epoch=|step=|lowest_value|saved model|>>>|starting|completed|successfully|error|fail|exception|traceback|training_speed|batch=/i;
const lastTqdmAt = new Map<string, number>();
const TQDM_THROTTLE_MS = 2000;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function isTqdmNoise(frag: string): boolean {
  return TQDM_NOISE_RE.test(frag) && !IMPORTANT_LINE_RE.test(frag);
}

function shouldKeepTqdm(jobId: string, frag: string): boolean {
  // Always show completion bars; otherwise at most one tqdm entry per window.
  if (/100%\s*\|/.test(frag)) return true;
  const now = Date.now();
  const last = lastTqdmAt.get(jobId) ?? 0;
  if (now - last < TQDM_THROTTLE_MS) return false;
  lastTqdmAt.set(jobId, now);
  return true;
}

// Split arbitrary stdout/stderr chunks into display fragments BEFORE
// truncating. The old `chunk.trim().slice(0, 1000)` kept only the head of a
// large chunk, so an `epoch=` line sharing a chunk with a tqdm burst was
// silently dropped and Epoch Progress stayed at "—" while training ran.
export function appendChunkLogs(
  job: Job,
  chunk: string,
  stream: "stdout" | "stderr",
  opts: { prefix?: boolean } = {},
): string[] {
  const kept: string[] = [];
  for (const raw of stripAnsi(chunk).split(/\r+\n?|\n/)) {
    const frag = raw.trim();
    if (!frag) continue;
    if (isTqdmNoise(frag) && !shouldKeepTqdm(job.id, frag)) continue;
    const line = (opts.prefix === false ? frag : `[${stream}] ${frag}`).slice(0, 2000);
    appendLog(job, line);
    kept.push(frag);
  }
  return kept;
}

export function trackPid(jobId: string, pid?: number, group = false) {
  if (pid) {
    jobPids.set(jobId, pid);
    if (group) jobGroups.add(jobId);
    else jobGroups.delete(jobId);
  } else {
    jobPids.delete(jobId);
    jobGroups.delete(jobId);
  }
}

export function killJobTree(jobId: string): boolean {
  const pid = jobPids.get(jobId);
  if (!pid) return false;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    } else if (jobGroups.has(jobId)) {
      process.kill(-pid, "SIGTERM");
      setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* already dead */
        }
      }, 5000).unref?.();
    } else {
      process.kill(pid, "SIGTERM");
      setTimeout(() => {
        try {
          process.kill(pid, 0);
          process.kill(pid, "SIGKILL");
        } catch {
          /* already dead */
        }
      }, 5000).unref?.();
    }
    return true;
  } catch {
    return false;
  }
}

export interface CliJobOptions {
  parse?: (stdout: string, stderr: string) => { result?: Record<string, unknown>; outputFile?: string };
  // Last stdout line required for commands that always exit 0.
  expectSuccess?: string | RegExp;
  // Live chunk stream (in addition to job logs), e.g. to derive progress.
  onChunk?: (chunk: string, stream: "stdout" | "stderr") => void;
}

// Spawns `python <args>` as a tracked job and returns immediately (202 {jobId}).
export function startCliJob(
  type: JobType,
  params: Record<string, unknown>,
  args: string[],
  opts: CliJobOptions = {},
): Job {
  const job = createJob(type, params);
  void (async () => {
    setRunning(job);
    try {
      const group = useGroupKill();
      const r = await runPythonModule(args, {
        detached: group,
        onData: (chunk, stream) => {
          appendChunkLogs(job, chunk, stream, { prefix: false });
          try {
            opts.onChunk?.(chunk, stream);
          } catch {
            /* progress parsing must never fail the job */
          }
        },
        onSpawn: (pid) => trackPid(job.id, pid, group),
      });
      trackPid(job.id, undefined);
      if (r.code !== 0) {
        throw new Error(r.stderr.slice(-3000) || `Process exited with code ${r.code}`);
      }
      const lastLine = lastStdoutLine(r.stdout);
      if (opts.expectSuccess) {
        const ok =
          typeof opts.expectSuccess === "string"
            ? lastLine === opts.expectSuccess || r.stdout.includes(opts.expectSuccess)
            : opts.expectSuccess.test(lastLine) || opts.expectSuccess.test(r.stdout);
        if (!ok) throw new Error(lastLine.slice(-1000) || "Job reported failure");
      }
      const parsed = opts.parse ? opts.parse(r.stdout, r.stderr) : undefined;
      const resultObj = parsed?.result ?? { message: lastLine || "Done" };
      const outputRel = parsed?.outputFile ? repoRel(parsed.outputFile) : undefined;
      setDone(job, resultObj, outputRel);
    } catch (err) {
      trackPid(job.id, undefined);
      appendLog(job, `ERROR: ${errMsg(err)}`);
      const j = getJob(job.id);
      if (j && j.status === "running") setError(j, errMsg(err) || "CLI job failed");
    }
  })();
  return job;
}

function lastStdoutLine(out: string): string {
  return (out.trim().split("\n").pop() ?? "").trim();
}

// One pipeline step: spawn in a killable group, require exit code 0 (or legacy 2333333)
// and success line match if expected.
export async function runJobStep(
  job: Job,
  args: string[],
  expected: string,
  step: string,
  opts: { onLine?: (line: string, stream: "stdout" | "stderr") => void } = {},
): Promise<void> {
  const group = useGroupKill();
  const r = await runPythonModule(args, {
    detached: group,
    onData: (chunk, stream) => {
      const kept = appendChunkLogs(job, chunk, stream);
      if (opts.onLine) {
        for (const line of kept) {
          try {
            opts.onLine(line, stream);
          } catch {
            /* progress parsing must never fail the job */
          }
        }
      }
    },
    onSpawn: (pid) => trackPid(job.id, pid, group),
  });
  trackPid(job.id, undefined);
  const successLineMatch = !expected || lastStdoutLine(r.stdout) === expected || r.stdout.includes(expected);
  if ((r.code !== 0 && r.code !== 2333333) || !successLineMatch)
    throw new Error(`${step} failed (code ${r.code}): ${(r.stderr || r.stdout).slice(-1000)}`);
}

// Runs `python -c <code>` where code prints one `APPLIO_JSON:{...}` line.
export async function runPythonJson<T = unknown>(code: string, onData?: (line: string) => void): Promise<T> {
  const r = await runPythonModule(["-c", code], {
    onData: (chunk, stream) => {
      if (stream === "stderr") onData?.(`[stderr] ${chunk.trim().slice(0, 500)}`);
    },
  });
  if (r.code !== 0) throw new Error(r.stderr.slice(-3000) || "Python failed");
  const m = r.stdout.match(/APPLIO_JSON:([^\r\n]+)/);
  if (!m) throw new Error(`Python did not return JSON: ${r.stdout.slice(-500)}`);
  return JSON.parse(m[1]) as T;
}

export function repoRel(absPath: string): string {
  return sharedRepoRel(absPath);
}
