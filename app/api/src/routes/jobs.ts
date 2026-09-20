import { type Request, type Response, Router } from "express";
import { getJob, listJobs, subscribeJob } from "@/jobs";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  res.json({ jobs: listJobs().map((j) => ({ ...j, logs: j.logs.slice(-20) })) });
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
    try {
      res.write(`data: ${JSON.stringify({ job: j })}\n\n`);
    } catch {
      /* client gone */
    }
    if (j.status === "done" || j.status === "error") {
      unsub();
      try {
        res.end();
      } catch {
        /* already closed */
      }
    }
  });
  req.on("close", unsub);
});

export default router;
