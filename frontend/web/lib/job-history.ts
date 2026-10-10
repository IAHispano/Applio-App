import type { Job } from "@/lib/api";

export function historyState(job: Job): string {
  if (job.status === "error") {
    if (/stopped by user|cancelled|canceled/i.test(job.error || "")) return "stopped";
    if (/interrupted by app/i.test(job.error || "")) return "interrupted";
  }
  return job.status;
}

export const historyStateLabels: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  done: "Completed",
  error: "Failed",
  stopped: "Stopped",
  interrupted: "Interrupted",
};

export function fieldLabel(key: string): string {
  const names: Record<string, string> = {
    pthPath: "Voice model",
    pthPath1: "First model",
    pthPath2: "Second model",
    indexPath: "Feature index",
    inputPath: "Input audio",
    inputFolder: "Input folder",
    outputPath: "Output path",
    outputFolder: "Output folder",
    modelName: "Model name",
    modelLink: "Download URL",
    f0Method: "Pitch method",
    f0UpKey: "Pitch shift",
    ttsText: "Text",
    ttsVoice: "Voice",
    sampleRate: "Sample rate",
    indexRate: "Index rate",
    setup: "Setup",
  };
  return (
    names[key] ||
    key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/^./, (char) => char.toUpperCase())
  );
}

export function fieldValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return JSON.stringify(value) ?? "—";
}

export function jobContext(job: Job): Array<[string, string]> {
  const params = job.params || {};
  return ["modelName", "pthPath", "model", "inputPath", "inputFolder", "modelLink", "url", "ttsVoice"]
    .filter((key) => typeof params[key] === "string" && params[key])
    .slice(0, 3)
    .map((key) => [fieldLabel(key), String(params[key])]);
}

export function duration(from: string, to: string | number): string {
  const milliseconds = Number(typeof to === "string" ? Date.parse(to) : to) - Date.parse(from);
  if (!Number.isFinite(milliseconds)) return "—";
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
