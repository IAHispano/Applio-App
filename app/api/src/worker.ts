import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { getPythonBin, getRepoRoot, pythonEnv } from "./python";
import { type InferenceParams } from "./schemas";

export interface InferenceRequest {
  id: string;
  params: InferenceParams;
  inputPath: string;
  outputPath: string;
  onLog: (msg: string) => void;
  resolve: (res: { outputPath: string; info: string }) => void;
  reject: (err: Error) => void;
}

interface WorkerIPCMessage {
  _applio_ipc?: boolean;
  type: "ready" | "pong" | "log" | "done" | "error" | "unloaded";
  id?: string;
  pid?: number;
  message?: string;
  outputPath?: string;
  info?: string;
  error?: string;
  traceback?: string;
}

export class InferenceWorkerManager {
  private child: ChildProcess | null = null;
  private queue: InferenceRequest[] = [];
  private activeJob: InferenceRequest | null = null;
  private isReady = false;
  private readyCallbacks: (() => void)[] = [];
  private restarting = false;

  constructor() {
    process.on("exit", () => this.stop());
  }

  public getPid(): number | undefined {
    return this.child?.pid;
  }

  public start() {
    if (this.child && !this.child.killed) return;
    const repoRoot = getRepoRoot();
    const workerScript = path.join(repoRoot, "rvc", "infer", "worker.py");
    const pyBin = getPythonBin();
    const pathEnv = `${repoRoot}${path.delimiter}${process.env.PATH || ""}`;

    const child = spawn(pyBin, [workerScript], {
      cwd: repoRoot,
      env: pythonEnv({ PATH: pathEnv }),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child = child;
    this.isReady = false;

    const rlOut = readline.createInterface({ input: child.stdout! });
    rlOut.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('{"_applio_ipc":')) {
        try {
          const msg = JSON.parse(trimmed) as WorkerIPCMessage;
          this.handleIPCMessage(msg);
          return;
        } catch {
        }
      }
      if (this.activeJob) {
        this.activeJob.onLog(trimmed);
      }
    });

    const rlErr = readline.createInterface({ input: child.stderr! });
    rlErr.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (this.activeJob) {
        this.activeJob.onLog(trimmed);
      }
    });

    child.on("error", (err) => {
      this.handleProcessExit(err);
    });

    child.on("exit", (code) => {
      this.handleProcessExit(new Error(`Inference worker exited with code ${code}`));
    });
  }

  private handleIPCMessage(msg: WorkerIPCMessage) {
    if (msg.type === "ready") {
      this.isReady = true;
      const cbs = [...this.readyCallbacks];
      this.readyCallbacks = [];
      for (const cb of cbs) cb();
      this.processNext();
    } else if (msg.type === "log") {
      if (this.activeJob && (!msg.id || this.activeJob.id === msg.id) && msg.message) {
        this.activeJob.onLog(msg.message);
      }
    } else if (msg.type === "done") {
      if (this.activeJob && this.activeJob.id === msg.id) {
        const job = this.activeJob;
        this.activeJob = null;
        job.resolve({ outputPath: msg.outputPath || "", info: msg.info || "" });
        this.processNext();
      }
    } else if (msg.type === "error") {
      if (this.activeJob && this.activeJob.id === msg.id) {
        const job = this.activeJob;
        this.activeJob = null;
        job.reject(new Error(msg.error || "Inference failed"));
        this.processNext();
      }
    }
  }

  private handleProcessExit(err: Error) {
    this.isReady = false;
    this.child = null;
    if (this.activeJob) {
      const job = this.activeJob;
      this.activeJob = null;
      job.reject(err);
    }
    if (this.queue.length > 0 && !this.restarting) {
      this.restarting = true;
      setTimeout(() => {
        this.restarting = false;
        this.start();
      }, 500);
    }
  }

  public waitReady(): Promise<void> {
    if (this.isReady && this.child) return Promise.resolve();
    this.start();
    return new Promise((resolve) => {
      this.readyCallbacks.push(resolve);
    });
  }

  public async infer(
    id: string,
    params: InferenceParams,
    inputPath: string,
    outputPath: string,
    onLog: (msg: string) => void,
  ): Promise<{ outputPath: string; info: string }> {
    return new Promise<{ outputPath: string; info: string }>((resolve, reject) => {
      this.queue.push({
        id,
        params,
        inputPath,
        outputPath,
        onLog,
        resolve,
        reject,
      });
      void this.waitReady().then(() => this.processNext());
    });
  }

  private processNext() {
    if (this.activeJob || this.queue.length === 0 || !this.isReady || !this.child) return;
    const req = this.queue.shift()!;
    this.activeJob = req;
    const payload = {
      command: "infer",
      id: req.id,
      inputPath: req.inputPath,
      outputPath: req.outputPath,
      params: req.params,
    };
    try {
      this.child.stdin!.write(JSON.stringify(payload) + "\n");
    } catch (err: unknown) {
      this.activeJob = null;
      req.reject(err instanceof Error ? err : new Error(String(err)));
      this.processNext();
    }
  }

  public stop() {
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* ignore */
      }
      this.child = null;
    }
  }
}

export const inferenceWorker = new InferenceWorkerManager();
