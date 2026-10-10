export interface JobActivity {
  id: string;
  type: string;
  label: string;
  status: "queued" | "running" | "done" | "error";
  createdAt: string;
  progress?: number;
  stopped?: boolean;
}

// One notification per lifecycle stage, including across stream reconnects.
// Finished history on the first snapshot is intentionally silent.
export class JobNotificationTracker {
  private states = new Map<string, JobActivity["status"]>();
  private initialized = false;

  snapshot(jobs: JobActivity[]): Array<{ job: JobActivity; terminal: boolean }> {
    if (!this.initialized) {
      this.initialized = true;
      for (const job of jobs) this.states.set(job.id, job.status);
      return jobs
        .filter((job) => job.status === "running" || job.status === "queued")
        .map((job) => ({ job, terminal: false }));
    }
    return jobs.flatMap((job) => this.update(job));
  }

  update(job: JobActivity): Array<{ job: JobActivity; terminal: boolean }> {
    const previous = this.states.get(job.id);
    if (previous === "done" || previous === "error") return [];
    this.states.set(job.id, job.status);
    const oldest = this.states.keys().next().value;
    if (this.states.size > 500 && oldest !== undefined) this.states.delete(oldest);
    const terminal = job.status === "done" || job.status === "error";
    if (previous === job.status || (!terminal && previous !== undefined)) return [];
    return [{ job, terminal }];
  }
}
