import type http from "node:http";
import net from "node:net";
import { type Request, type Response, Router } from "express";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { loadConfig, saveConfig } from "@/config";
import { errMsg } from "@/errors";
import { getRepoRoot, pythonEnv, spawnPython } from "@/python";
import { RealtimeProcessManager } from "@/realtime-process";
import { beginRealtimeSession, gpuJobRunning, schedulerStatus } from "@/scheduler";
import { assertEngineReady } from "@/setup";
import { inferenceWorker } from "@/worker";

const router = Router();
export const RT_PORT = Number(process.env.RT_PORT || 8001);

const manager = new RealtimeProcessManager(
  (graphsDisabled) =>
    spawnPython(
      ["-m", "uvicorn", "rvc.realtime.client:app", "--host", "127.0.0.1", "--port", String(RT_PORT)],
      {
        cwd: getRepoRoot(),
        detached: process.platform !== "win32",
        env: pythonEnv({
          APPLIO_ENABLE_CUDA_GRAPHS: process.env.APPLIO_ENABLE_CUDA_GRAPHS || "1",
          ...(graphsDisabled ? { APPLIO_DISABLE_CUDA_GRAPHS: "1" } : {}),
        }),
      },
    ),
  process.platform !== "win32",
);

function backend(pathname: string): string {
  // The uvicorn engine (rvc/realtime/client.py) serves unprefixed routes:
  // /ws-audio, /change-config, /record. The /api prefix only exists on
  // this gateway + the Next.js rewrites, never upstream.
  return `http://127.0.0.1:${RT_PORT}${pathname}`;
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

router.get("/status", async (_req: Request, res: Response) => {
  const alive = manager.proc !== null && manager.proc.exitCode === null;
  const reachable = await portOpen(RT_PORT);
  res.json({
    running: alive && reachable,
    startedAt: manager.startedAt,
    wsAudio: `/api/realtime/ws-audio`,
    wsConfig: `/api/realtime/change-config`,
    logs: manager.logs.slice(-30),
    scheduling: schedulerStatus(),
  });
});

// Background prewarm of the realtime engine so it is instantly reachable
router.post("/prewarm", async (_req: Request, res: Response) => {
  await manager.waitForStop();
  try {
    await assertEngineReady();
  } catch (err) {
    return res.status(503).json({ error: errMsg(err) });
  }
  try {
    if (manager.proc && manager.proc.exitCode === null && (await portOpen(RT_PORT))) {
      return res.json({ ok: true, running: true, startedAt: manager.startedAt });
    }
    if (!manager.proc || manager.proc.exitCode !== null) {
      manager.start();
    }
    return res.json({ ok: true, starting: true });
  } catch (err) {
    return res.status(500).json({ error: errMsg(err) });
  }
});

router.post("/start", async (_req: Request, res: Response) => {
  await manager.waitForStop();
  if (gpuJobRunning())
    return res
      .status(409)
      .json({ error: "A GPU job is running. Stop it or wait for it to finish before starting realtime." });
  try {
    await assertEngineReady();
  } catch (err) {
    return res.status(503).json({ error: errMsg(err) });
  }
  try {
    if (manager.proc && manager.proc.exitCode === null && (await portOpen(RT_PORT))) {
      return res.json({ ok: true, reused: true, startedAt: manager.startedAt });
    }
    if (!manager.proc || manager.proc.exitCode !== null) manager.start();
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (!manager.proc || (manager.proc.exitCode !== null && manager.proc.exitCode !== undefined)) {
        manager.proc = null;
        return res.status(500).json({
          error: "Realtime engine exited. Check uvicorn is installed and a GPU/model is available.",
          logs: manager.logs.slice(-10),
        });
      }
      if (await portOpen(RT_PORT)) return res.json({ ok: true, startedAt: manager.startedAt });
    }
    return res
      .status(504)
      .json({ error: "Realtime engine did not come up in time.", logs: manager.logs.slice(-10) });
  } catch (err) {
    return res.status(500).json({ error: errMsg(err) });
  }
});

router.post("/stop", async (_req: Request, res: Response) => {
  await manager.stop();
  res.json({ ok: true });
});

export function stopRealtime(): void {
  manager.stop();
}

router.post("/record", async (req: Request, res: Response) => {
  try {
    const r = await fetch(backend("/record"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    const body = await r.json().catch(() => ({}));
    res.status(r.status).json(body);
  } catch (err) {
    res.status(502).json({ error: `Engine unreachable: ${errMsg(err)}` });
  }
});

router.get("/config", (_req: Request, res: Response) => {
  try {
    const cfg = loadConfig();
    res.json({ realtime: cfg.realtime || {} });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});
router.put("/config", (req: Request, res: Response) => {
  try {
    const cfg = loadConfig() as {
      realtime?: Record<string, unknown>;
    };
    cfg.realtime = { ...(cfg.realtime || {}), ...((req.body || {}) as Record<string, unknown>) };
    saveConfig(cfg);
    res.json({ ok: true, realtime: cfg.realtime });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

/** Attach WS upgrade proxying: /api/realtime/ws-audio + /change-config -> engine (binary-safe). */
export function attachRealtimeProxy(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", async (req, socket, head) => {
    const url = req.url || "";
    let target: string | null = null;
    if (url.startsWith("/api/realtime/ws-audio")) target = `ws://127.0.0.1:${RT_PORT}/ws-audio`;
    else if (url.startsWith("/api/realtime/change-config"))
      target = `ws://127.0.0.1:${RT_PORT}/change-config`;
    if (!target) return; // not ours
    const audio = url.startsWith("/api/realtime/ws-audio");
    const release = audio ? beginRealtimeSession() : undefined;
    if (audio && !release) {
      socket.end("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\nGPU is busy.");
      return;
    }
    let upgraded = false;
    try {
      if (audio) await inferenceWorker.releaseGpu();
      if (socket.destroyed) return;
      wss.handleUpgrade(req, socket, head, (client) => {
        upgraded = true;
        proxySocket(client, target as string, release || undefined);
      });
    } catch (error) {
      console.warn("[realtime] Could not open audio session:", error);
      socket.destroy();
    } finally {
      if (!upgraded) release?.();
    }
  });
}

function proxySocket(client: WebSocket, target: string, release?: () => void) {
  const upstream = new WebSocket(target);
  const queue: Array<{ data: RawData; binary: boolean }> = [];
  const timer = setTimeout(() => close(), 15000);
  let closed = false;
  client.on("message", (data, isBinary) => {
    if (upstream.bufferedAmount > 1024 * 1024 || queue.length >= 16) {
      close();
      return;
    }
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    else queue.push({ data, binary: isBinary });
  });
  upstream.on("open", () => {
    clearTimeout(timer);
    for (const m of queue) {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(m.data, { binary: m.binary });
    }
    queue.length = 0;
  });
  upstream.on("message", (data, isBinary) => {
    if (client.bufferedAmount > 1024 * 1024) {
      close();
      return;
    }
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    queue.length = 0;
    // Terminate the realtime process before admitting waiting GPU work. This
    // also releases CUDA allocations even if Python's disconnect cleanup fails.
    if (release) void manager.stop().then(release);
    try {
      client.close();
    } catch {
      /* noop */
    }
    try {
      upstream.close();
    } catch {
      /* noop */
    }
  };
  client.on("close", close);
  upstream.on("close", close);
  client.on("error", close);
  upstream.on("error", close);
}

export default router;
