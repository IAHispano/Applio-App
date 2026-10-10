import type { ChildProcess } from "node:child_process";

// A failed CUDA capture can leave PyTorch's allocator/RNG unusable. Recover
// in a fresh process, with graphs disabled, rather than reusing that context.
export const REALTIME_GRAPH_FAILURE_EXIT = 86;

export class RealtimeProcessManager {
  proc: ChildProcess | null = null;
  startedAt: string | null = null;
  logs: string[] = [];
  graphsDisabled = false;

  constructor(private readonly spawn: (graphsDisabled: boolean) => ChildProcess) {}

  start(clearLogs = true): ChildProcess {
    const previous = this.proc;
    this.proc = null;
    previous?.kill();
    if (clearLogs) this.logs = [];
    const proc = this.spawn(this.graphsDisabled);
    this.proc = proc;
    this.startedAt = new Date().toISOString();
    proc.stdout?.on("data", (data: Buffer) => this.append(data.toString().trim().slice(0, 500)));
    proc.stderr?.on("data", (data: Buffer) =>
      this.append(`[stderr] ${data.toString().trim().slice(0, 500)}`),
    );
    proc.on("error", (error) => {
      this.append(`spawn error: ${String(error)}`);
      if (this.proc === proc) this.proc = null;
    });
    proc.on("exit", (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (code === REALTIME_GRAPH_FAILURE_EXIT && !this.graphsDisabled) {
        this.graphsDisabled = true;
        this.append("Restarting realtime with eager inference after an unsupported CUDA graph.");
        try {
          this.start(false);
        } catch (error) {
          this.append(`Realtime restart failed: ${String(error)}`);
        }
      }
    });
    return proc;
  }

  stop(): void {
    const proc = this.proc;
    this.proc = null;
    this.startedAt = null;
    proc?.kill();
  }

  private append(line: string): void {
    this.logs.push(line);
    if (this.logs.length > 200) this.logs = this.logs.slice(-200);
  }
}
