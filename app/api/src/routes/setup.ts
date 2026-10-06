import { type Request, type Response, Router } from "express";
import { apiError } from "@/errors";
import { findPython, getStatus, startInstall, startPrerequisites } from "@/setup";

const router = Router();

router.get("/status", async (req: Request, res: Response) => {
  try {
    res.json(await getStatus(req.query.refresh === "1"));
  } catch (err) {
    res.status(500).json(apiError(err));
  }
});

router.post("/install", (_req: Request, res: Response) => {
  try {
    const job = startInstall();
    res.status(202).json({ jobId: job.id });
  } catch (err) {
    res.status(500).json(apiError(err));
  }
});

router.post("/prerequisites", async (_req: Request, res: Response) => {
  try {
    const py = await findPython();
    res.status(202).json({ jobId: startPrerequisites(py ? py.cmd : null).id });
  } catch (err) {
    res.status(500).json(apiError(err));
  }
});

export default router;
