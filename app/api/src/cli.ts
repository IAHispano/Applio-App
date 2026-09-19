import { spawn } from "node:child_process";
import { errMsg } from "./errors";
import { appendLog, createJob, getJob, type Job, type JobType, setDone, setError, setRunning } from "./jobs";
import { repoRel as sharedRepoRel } from "./lib/fsutils";
import { runPythonModule } from "./python";

const jobPids = new Map<string, number>();
const jobGroups = new Set<string>();
const useGroupKill = () => process.platform !== "win32";

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
        onData: (chunk) => {
          const trimmed = chunk.trim().slice(0, 1000);
          if (trimmed) appendLog(job, trimmed);
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
            ? lastLine === opts.expectSuccess
            : opts.expectSuccess.test(lastLine);
        if (!ok) throw new Error(lastLine.slice(-1000) || "Job reported failure");
      }
      const parsed = opts.parse?.(r.stdout, r.stderr);
      setDone(job, parsed?.result ?? { message: r.stdout.trim().split("\n").pop() }, parsed?.outputFile);
    } catch (err) {
      trackPid(job.id, undefined);
      appendLog(job, `ERROR: ${errMsg(err)}`);
      const j = getJob(job.id);
      if (j && j.status === "running") setError(j, errMsg(err) || "Job failed");
    }
  })();
  return job;
}

export function lastStdoutLine(out: string): string {
  return (out.trim().split("\n").pop() ?? "").trim();
}

// One pipeline step: spawn in a killable group, require the exact success
// line (never substring matching), throw otherwise.
export async function runJobStep(job: Job, args: string[], expected: string, step: string): Promise<void> {
  const group = useGroupKill();
  const r = await runPythonModule(args, {
    detached: group,
    onData: (chunk, stream) => appendLog(job, `[${stream}] ${chunk.trim().slice(0, 1000)}`),
    onSpawn: (pid) => trackPid(job.id, pid, group),
  });
  trackPid(job.id, undefined);
  if (r.code !== 0 || lastStdoutLine(r.stdout) !== expected)
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
  const marker = r.stdout.split("\n").find((l) => l.startsWith("APPLIO_JSON:"));
  if (!marker) throw new Error(`Python did not return JSON: ${r.stdout.slice(-500)}`);
  return JSON.parse(marker.slice("APPLIO_JSON:".length)) as T;
}

export function repoRel(absPath: string): string {
  return sharedRepoRel(absPath);
}
