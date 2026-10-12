import fs from "node:fs";
import path from "node:path";

/** Small metadata only: never retain checkpoint tensors or audio buffers. */
export class FileMetadataCache<T> {
  private entries = new Map<string, { signature: string; value: T }>();
  private pending = new Map<string, { signature: string; promise: Promise<T> }>();
  constructor(private readonly limit = 64) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid metadata cache limit");
  }

  private signature(file: string): string {
    const stamp = (target: string) => {
      try {
        const stat = fs.statSync(target);
        return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
        throw error;
      }
    };
    return `${stamp(file)}|${stamp(path.join(path.dirname(file), "model_info.json"))}`;
  }

  async get(file: string, load: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
    file = path.resolve(file);
    const signature = this.signature(file);
    const cached = this.entries.get(file);
    if (cached?.signature === signature) {
      this.entries.delete(file);
      this.entries.set(file, cached);
      return { value: cached.value, cached: true };
    }
    this.entries.delete(file);
    const waiting = this.pending.get(file);
    if (waiting?.signature === signature) return { value: await waiting.promise, cached: false };
    const entry = { signature, promise: Promise.resolve().then(load) };
    this.pending.set(file, entry);
    try {
      const value = await entry.promise;
      if (this.pending.get(file) === entry && this.signature(file) === signature) {
        this.entries.set(file, { signature, value });
        while (this.entries.size > this.limit)
          this.entries.delete(this.entries.keys().next().value as string);
      }
      return { value, cached: false };
    } finally {
      if (this.pending.get(file) === entry) this.pending.delete(file);
    }
  }
}
