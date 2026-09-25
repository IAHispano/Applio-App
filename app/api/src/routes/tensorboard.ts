import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { type Request, type Response, Router } from "express";
import { errMsg } from "@/errors";
import { getPythonGuiBin, getRepoRoot, noEnv, pythonEnv } from "@/python";

const router = Router();
const TB_PORT = Number(process.env.TB_PORT || 6007);

let tbProc: ChildProcess | null = null;
let tbStartedAt: string | null = null;
let startingPromise: Promise<{ ok: boolean; url: string; error?: string }> | null = null;

function tbUrl(): string {
  return `http://127.0.0.1:${TB_PORT}`;
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      try {
        s.destroy();
      } catch {
        /* noop */
      }
      resolve(result);
    };
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => finish(true));
    s.on("error", () => finish(false));
    const timer = setTimeout(() => finish(false), 1500);
    timer.unref?.();
  });
}

async function waitForPortClose(port: number, maxMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (!(await portOpen(port))) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return !(await portOpen(port));
}

function killProcess(proc: ChildProcess | null): void {
  const pid = proc?.pid;
  if (pid) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
      } else {
        process.kill(pid, "SIGTERM");
      }
    } catch {
      /* already stopped */
    }
  }
  try {
    proc?.kill();
  } catch {
    /* already stopped */
  }
}

export function stopTensorboard(): void {
  killProcess(tbProc);
  tbProc = null;
  tbStartedAt = null;
  startingPromise = null;
}

export async function startTensorboard(): Promise<{ ok: boolean; url: string; error?: string }> {
  // If already launching, return the in-flight startup promise
  if (startingPromise) {
    return startingPromise;
  }

  // If process is alive and port is responding, return ok immediately
  const isReachable = await portOpen(TB_PORT);
  if (tbProc && tbProc.exitCode === null && isReachable) {
    return { ok: true, url: tbUrl() };
  }

  // Clear any dead/stale process references before launching
  if (tbProc) {
    killProcess(tbProc);
    tbProc = null;
    tbStartedAt = null;
    await waitForPortClose(TB_PORT, 2000);
  }

  const p = (async () => {
    try {
      const root = getRepoRoot();
      const logsDir = path.join(root, "logs");
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const pythonBin = getPythonGuiBin();
      console.log(`[tensorboard] starting on ${tbUrl()} using ${pythonBin}`);

      const proc = spawn(
        pythonBin,
        ["-m", "tensorboard.main", "--logdir", "logs", "--host", "127.0.0.1", "--port", String(TB_PORT)],
        {
          cwd: root,
          windowsHide: true,
          env: pythonEnv(),
        },
      );
      tbProc = proc;
      tbStartedAt = new Date().toISOString();

      let exitError: string | null = null;
      proc.on("error", (err) => {
        console.error("[tensorboard] process error:", err);
        exitError = errMsg(err) || "Failed to start TensorBoard process";
        if (tbProc === proc) tbProc = null;
      });

      proc.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          console.warn(`[tensorboard] exited with code ${code}`);
          exitError = `TensorBoard process exited with code ${code}`;
        }
        if (tbProc === proc) tbProc = null;
      });

      // Poll until port becomes reachable or process exits
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (proc.exitCode !== null && proc.exitCode !== undefined) {
          const err =
            exitError || "TensorBoard process exited immediately. Check logs or pip install tensorboard.";
          console.error(`[tensorboard] ${err}`);
          if (tbProc === proc) tbProc = null;
          return { ok: false, url: tbUrl(), error: err };
        }
        if (await portOpen(TB_PORT)) {
          console.log(`[tensorboard] ready on ${tbUrl()}`);
          return { ok: true, url: tbUrl() };
        }
      }

      return { ok: false, url: tbUrl(), error: "TensorBoard did not come up in time." };
    } catch (err) {
      killProcess(tbProc);
      tbProc = null;
      tbStartedAt = null;
      return { ok: false, url: tbUrl(), error: errMsg(err) || "Could not start TensorBoard" };
    } finally {
      startingPromise = null;
    }
  })();

  startingPromise = p;
  return p;
}

export async function restartTensorboard(): Promise<{ ok: boolean; url: string; error?: string }> {
  // Stop existing instance and invalidate starting state
  killProcess(tbProc);
  tbProc = null;
  tbStartedAt = null;
  startingPromise = null;

  // Ensure port is completely released before spawning anew
  await waitForPortClose(TB_PORT, 3000);

  return startTensorboard();
}

export function autoStartTensorboard(): void {
  if (noEnv()) return;
  // Asynchronously launch in the background at startup without blocking
  void startTensorboard().catch((err) => {
    console.warn("[tensorboard] auto-start failed:", err);
  });
}

router.get("/status", async (_req: Request, res: Response) => {
  const alive = tbProc !== null && tbProc.exitCode === null;
  const reachable = await portOpen(TB_PORT);
  const isRunning = alive && reachable;

  res.json({
    running: isRunning,
    starting: startingPromise !== null,
    url: tbUrl(),
    startedAt: tbStartedAt,
  });
});

router.post("/start", async (_req: Request, res: Response) => {
  const result = await startTensorboard();
  if (result.ok) {
    return res.json({ ok: true, url: result.url, startedAt: tbStartedAt });
  }
  return res.status(500).json({ error: result.error || "Could not start TensorBoard" });
});

router.post("/restart", async (_req: Request, res: Response) => {
  const result = await restartTensorboard();
  if (result.ok) {
    return res.json({ ok: true, url: result.url, startedAt: tbStartedAt });
  }
  return res.status(500).json({ error: result.error || "Could not restart TensorBoard" });
});

router.post("/stop", (_req: Request, res: Response) => {
  stopTensorboard();
  res.json({ ok: true });
});

export default router;
