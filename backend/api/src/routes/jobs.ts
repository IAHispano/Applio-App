import { type Request, type Response, Router } from "express";
import { getJob, jobSummary, listJobs, subscribeAllJobs, subscribeJob } from "@/jobs";
import { schedulerStatus } from "@/scheduler";

const router = Router();

router.get("/activity", (_req: Request, res: Response) => {
  res.json({ jobs: listJobs().map(jobSummary) });
});

router.get("/events", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`data: ${JSON.stringify({ jobs: listJobs().map(jobSummary) })}\n\n`);
  const unsubscribe = subscribeAllJobs((job) => {
    if (res.writableLength > 1024 * 1024) {
      res.destroy();
      return;
    }
    res.write(`data: ${JSON.stringify({ job })}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

router.get("/", (_req: Request, res: Response) => {
  res.json({
    jobs: listJobs().map((j) => ({ ...j, label: jobSummary(j).label, logs: j.logs.slice(-20) })),
    scheduling: schedulerStatus(),
  });
});

router.get("/:id", (req: Request, res: Response) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({ job });
});

// Live job stream (server-sent events, proxy-safe unlike websockets).
// Pushes the full job snapshot immediately, on every update while active,
// and closes itself on terminal states.
router.get("/:id/events", (req: Request, res: Response) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`data: ${JSON.stringify({ job })}\n\n`);
  if (job.status === "done" || job.status === "error") {
    res.end();
    return;
  }
  const unsub = subscribeJob(job.id, (j) => {
    if (res.writableLength > 1024 * 1024) {
      res.destroy();
      return;
    }
    try {
      res.write(`data: ${JSON.stringify({ job: j })}\n\n`);
    } catch {
      /* client gone */
    }
    if (j.status === "done" || j.status === "error") {
      unsub();
      clearInterval(heartbeat);
      try {
        res.end();
      } catch {
        /* already closed */
      }
    }
  });
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsub();
  });
});

export default router;
