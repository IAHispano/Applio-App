import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { v4 as uuidv4 } from "uuid";
import { getPythonBin, getRepoRoot, pythonEnv } from "@/python";
import type { BatchInferenceParams, InferenceParams, TtsParams } from "@/schemas";

export interface SingleInferRequest {
  command: "infer";
  id: string;
  params: InferenceParams;
  inputPath: string;
  outputPath: string;
  onLog: (msg: string) => void;
  resolve: (res: { outputPath: string; info: string }) => void;
  reject: (err: Error) => void;
}

export interface BatchInferRequest {
  command: "infer_batch";
  id: string;
  params: BatchInferenceParams;
  inputFolder: string;
  outputFolder: string;
  onLog: (msg: string) => void;
  resolve: (res: { info: string }) => void;
  reject: (err: Error) => void;
}

export interface TtsWorkerRequest {
  command: "tts";
  id: string;
  params: Partial<TtsParams>;
  ttsText?: string;
  ttsFile?: string;
  ttsVoice: string;
  ttsRate: number;
  outputTtsPath: string;
  outputRvcPath?: string;
  onLog: (msg: string) => void;
  resolve: (res: { outputTtsPath: string; outputRvcPath?: string; outputPath: string; info: string }) => void;
  reject: (err: Error) => void;
}

export interface AnalyzeAudioRequest {
  command: "analyze_audio";
  id: string;
  inputPath: string;
  plotPath: string;
  onLog: (msg: string) => void;
  resolve: (res: { info: unknown; plot: string }) => void;
  reject: (err: Error) => void;
}

export interface F0CurveRequest {
  command: "f0_curve";
  id: string;
  inputPath: string;
  method: string;
  outputImage: string;
  outputTxt: string;
  onLog: (msg: string) => void;
  resolve: (res: { outputImage: string; outputTxt: string }) => void;
  reject: (err: Error) => void;
}

export interface ModelBlenderRequest {
  command: "model_blender";
  id: string;
  modelName: string;
  pth1: string;
  pth2: string;
  ratio: number;
  onLog: (msg: string) => void;
  resolve: (res: { message: string; file: string | null }) => void;
  reject: (err: Error) => void;
}

export interface InspectModelRequest {
  command: "inspect_model";
  id: string;
  pthPath: string;
  onLog: (msg: string) => void;
  resolve: (res: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}

export type WorkerRequest =
  | SingleInferRequest
  | BatchInferRequest
  | TtsWorkerRequest
  | AnalyzeAudioRequest
  | F0CurveRequest
  | ModelBlenderRequest
  | InspectModelRequest;

export type InferenceRequest = SingleInferRequest;

interface WorkerIPCMessage {
  _applio_ipc?: boolean;
  type: "ready" | "pong" | "log" | "done" | "error" | "unloaded";
  id?: string;
  pid?: number;
  message?: string;
  outputPath?: string;
  outputTtsPath?: string;
  outputRvcPath?: string;
  outputImage?: string;
  outputTxt?: string;
  info?: unknown;
  plot?: string;
  file?: string | null;
  metadata?: Record<string, unknown>;
  error?: string;
  traceback?: string;
}

export class InferenceWorkerManager {
  private child: ChildProcess | null = null;
  private queue: WorkerRequest[] = [];
  private activeJob: WorkerRequest | null = null;
  private isReady = false;
  private readyCallbacks: (() => void)[] = [];
  private restarting = false;
  private warmedUp = false;
  private warmupTimer?: NodeJS.Timeout;

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
    this.warmedUp = false;

    if (!child.stdout || !child.stderr) {
      this.child = null;
      return;
    }

    const rlOut = readline.createInterface({ input: child.stdout });
    rlOut.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('{"_applio_ipc":')) {
        try {
          const msg = JSON.parse(trimmed) as WorkerIPCMessage;
          this.handleIPCMessage(msg);
          return;
        } catch {}
      }
      if (this.activeJob) {
        this.activeJob.onLog(trimmed);
      }
    });

    const rlErr = readline.createInterface({ input: child.stderr });
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
        if (job.command === "infer") {
          job.resolve({ outputPath: msg.outputPath || "", info: String(msg.info || "") });
        } else if (job.command === "infer_batch") {
          job.resolve({ info: String(msg.info || "Batch inference completed") });
        } else if (job.command === "tts") {
          job.resolve({
            outputTtsPath: msg.outputTtsPath || "",
            outputRvcPath: msg.outputRvcPath,
            outputPath: msg.outputPath || msg.outputRvcPath || msg.outputTtsPath || "",
            info: String(msg.info || "TTS completed"),
          });
        } else if (job.command === "analyze_audio") {
          job.resolve({ info: msg.info, plot: msg.plot || "" });
        } else if (job.command === "f0_curve") {
          job.resolve({ outputImage: msg.outputImage || "", outputTxt: msg.outputTxt || "" });
        } else if (job.command === "model_blender") {
          job.resolve({ message: msg.message || "Model blended", file: msg.file ?? null });
        } else if (job.command === "inspect_model") {
          job.resolve(msg.metadata || {});
        }
        this.processNext();
      }
    } else if (msg.type === "error") {
      if (this.activeJob && this.activeJob.id === msg.id) {
        const job = this.activeJob;
        this.activeJob = null;
        job.reject(new Error(msg.error || "Worker task failed"));
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

  public warmupDelayed(ms = 3000) {
    if (this.warmupTimer) clearTimeout(this.warmupTimer);
    this.warmupTimer = setTimeout(() => {
      void this.warmup().catch(() => {});
    }, ms);
  }

  public async warmup(): Promise<void> {
    if (this.warmedUp) return;
    await this.waitReady();
    if (this.warmedUp || this.activeJob || this.queue.length > 0 || !this.child) return;
    this.warmedUp = true;
    try {
      this.child.stdin?.write(`${JSON.stringify({ command: "warmup" })}\n`);
    } catch {
      this.warmedUp = false;
    }
  }

  public async preloadModel(pthPath: string, sid = 0): Promise<void> {
    await this.waitReady();
    if (!this.child) return;
    try {
      this.child.stdin?.write(`${JSON.stringify({ command: "preload_model", pthPath, sid })}\n`);
    } catch {
      /* ignore */
    }
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
        command: "infer",
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

  public async inferBatch(
    id: string,
    params: BatchInferenceParams,
    inputFolder: string,
    outputFolder: string,
    onLog: (msg: string) => void,
  ): Promise<{ info: string }> {
    return new Promise<{ info: string }>((resolve, reject) => {
      this.queue.push({
        command: "infer_batch",
        id,
        params,
        inputFolder,
        outputFolder,
        onLog,
        resolve,
        reject,
      });
      void this.waitReady().then(() => this.processNext());
    });
  }

  public async tts(
    id: string,
    options: {
      params: Partial<TtsParams>;
      ttsText?: string;
      ttsFile?: string;
      ttsVoice: string;
      ttsRate: number;
      outputTtsPath: string;
      outputRvcPath?: string;
    },
    onLog: (msg: string) => void,
  ): Promise<{ outputTtsPath: string; outputRvcPath?: string; outputPath: string; info: string }> {
    return new Promise<{ outputTtsPath: string; outputRvcPath?: string; outputPath: string; info: string }>(
      (resolve, reject) => {
        this.queue.push({
          command: "tts",
          id,
          params: options.params,
          ttsText: options.ttsText,
          ttsFile: options.ttsFile,
          ttsVoice: options.ttsVoice,
          ttsRate: options.ttsRate,
          outputTtsPath: options.outputTtsPath,
          outputRvcPath: options.outputRvcPath,
          onLog,
          resolve,
          reject,
        });
        void this.waitReady().then(() => this.processNext());
      },
    );
  }

  public async analyzeAudio(
    id: string,
    inputPath: string,
    plotPath: string,
    onLog: (msg: string) => void,
  ): Promise<{ info: unknown; plot: string }> {
    return new Promise<{ info: unknown; plot: string }>((resolve, reject) => {
      this.queue.push({
        command: "analyze_audio",
        id,
        inputPath,
        plotPath,
        onLog,
        resolve,
        reject,
      });
      void this.waitReady().then(() => this.processNext());
    });
  }

  public async extractF0(
    id: string,
    inputPath: string,
    method: string,
    outputImage: string,
    outputTxt: string,
    onLog: (msg: string) => void,
  ): Promise<{ outputImage: string; outputTxt: string }> {
    return new Promise<{ outputImage: string; outputTxt: string }>((resolve, reject) => {
      this.queue.push({
        command: "f0_curve",
        id,
        inputPath,
        method,
        outputImage,
        outputTxt,
        onLog,
        resolve,
        reject,
      });
      void this.waitReady().then(() => this.processNext());
    });
  }

  public async blendModels(
    id: string,
    modelName: string,
    pth1: string,
    pth2: string,
    ratio: number,
    onLog: (msg: string) => void,
  ): Promise<{ message: string; file: string | null }> {
    return new Promise<{ message: string; file: string | null }>((resolve, reject) => {
      this.queue.push({
        command: "model_blender",
        id,
        modelName,
        pth1,
        pth2,
        ratio,
        onLog,
        resolve,
        reject,
      });
      void this.waitReady().then(() => this.processNext());
    });
  }

  public async inspectModel(pthPath: string): Promise<Record<string, unknown>> {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.queue.push({
        command: "inspect_model",
        id: uuidv4(),
        pthPath,
        onLog: () => {},
        resolve,
        reject,
      });
      void this.waitReady().then(() => this.processNext());
    });
  }

  private processNext() {
    if (this.activeJob || this.queue.length === 0 || !this.isReady || !this.child) return;
    const req = this.queue.shift();
    if (!req) return;
    this.activeJob = req;

    let payload: Record<string, unknown>;
    if (req.command === "infer") {
      payload = {
        command: "infer",
        id: req.id,
        inputPath: req.inputPath,
        outputPath: req.outputPath,
        params: req.params,
      };
    } else if (req.command === "infer_batch") {
      payload = {
        command: "infer_batch",
        id: req.id,
        inputFolder: req.inputFolder,
        outputFolder: req.outputFolder,
        params: req.params,
      };
    } else if (req.command === "tts") {
      payload = {
        command: "tts",
        id: req.id,
        ttsText: req.ttsText,
        ttsFile: req.ttsFile,
        ttsVoice: req.ttsVoice,
        ttsRate: req.ttsRate,
        outputTtsPath: req.outputTtsPath,
        outputRvcPath: req.outputRvcPath,
        params: req.params,
      };
    } else if (req.command === "analyze_audio") {
      payload = {
        command: "analyze_audio",
        id: req.id,
        inputPath: req.inputPath,
        plotPath: req.plotPath,
      };
    } else if (req.command === "f0_curve") {
      payload = {
        command: "f0_curve",
        id: req.id,
        inputPath: req.inputPath,
        method: req.method,
        outputImage: req.outputImage,
        outputTxt: req.outputTxt,
      };
    } else if (req.command === "model_blender") {
      payload = {
        command: "model_blender",
        id: req.id,
        modelName: req.modelName,
        pth1: req.pth1,
        pth2: req.pth2,
        ratio: req.ratio,
      };
    } else if (req.command === "inspect_model") {
      payload = {
        command: "inspect_model",
        id: req.id,
        pthPath: req.pthPath,
      };
    } else {
      this.activeJob = null;
      this.processNext();
      return;
    }

    try {
      this.child.stdin?.write(`${JSON.stringify(payload)}\n`);
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
