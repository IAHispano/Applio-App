import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Job } from "@/jobs";

// Atomic snapshots keep a bounded history without introducing a database service.
export class JobHistory {
  private revision = 0;
  private pending = new Set<Promise<void>>();
  constructor(private readonly file: string) {}

  load(): Job[] {
    if (!fs.existsSync(this.file)) return [];
    try {
      const data: unknown = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!Array.isArray(data)) throw new Error("Expected a job history array");
      return data.slice(-200).map((value: unknown) => {
        const job = value as Job;
        if (
          !job ||
          typeof job.id !== "string" ||
          !/^[a-f0-9-]{36}$/.test(job.id) ||
          !["queued", "running", "done", "error"].includes(job.status) ||
          !["inference", "batch-inference", "train", "tts", "download", "other"].includes(job.type) ||
          !Number.isFinite(Date.parse(job.createdAt)) ||
          !Array.isArray(job.logs)
        ) {
          throw new Error("Invalid job history entry");
        }
        job.logs = job.logs
          .filter((line): line is string => typeof line === "string")
          .slice(-500)
          .map((line) => line.slice(0, 2000));
        if (job.status === "queued" || job.status === "running") {
          job.status = "error";
          job.error = "Interrupted by app restart. Start the job again to continue.";
          job.finishedAt = job.updatedAt = new Date().toISOString();
        }
        return job;
      });
    } catch (error) {
      // Retain damaged history for recovery instead of overwriting it.
      try {
        fs.renameSync(this.file, `${this.file}.${randomUUID()}.corrupt`);
      } catch {}
      console.warn("[jobs] Could not restore job history:", error);
      return [];
    }
  }

  save(jobs: Job[]): void {
    this.revision++;
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(temporary, this.serialize(jobs), { flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } catch (error) {
      console.warn("[jobs] Could not save job history:", error);
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch {}
    }
  }

  private serialize(jobs: Job[]): string {
    return JSON.stringify(jobs.map((job) => ({ ...job, logs: job.logs.slice(-100) })));
  }

  saveAsync(jobs: Job[]): Promise<void> {
    const revision = ++this.revision;
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    const data = this.serialize(jobs);
    const operation = this.writeSnapshot(revision, temporary, data);
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation));
    return operation;
  }

  async drain(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private async writeSnapshot(revision: number, temporary: string, data: string): Promise<void> {
    try {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      await fs.promises.writeFile(temporary, data, { flag: "wx", mode: 0o600 });
      // Publish synchronously so a newer sync snapshot cannot be overwritten
      // between checking its revision and publishing this completed write.
      if (revision === this.revision) fs.renameSync(temporary, this.file);
    } catch (error) {
      console.warn("[jobs] Could not save job history:", error);
    } finally {
      try {
        await fs.promises.unlink(temporary);
      } catch {}
    }
  }
}
