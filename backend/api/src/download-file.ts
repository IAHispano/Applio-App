import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

interface DownloadOptions {
  signal?: AbortSignal;
  sha256?: string;
  onProgress?: (received: number, total: number) => void;
  onRetry?: (attempt: number) => void;
}
interface PartialMetadata {
  url: string;
  validator: string;
  total: number;
}
const downloads = new Map<string, { url: string; promise: Promise<void> }>();

export function downloadFile(url: string, destination: string, options: DownloadOptions = {}): Promise<void> {
  if (!["http:", "https:"].includes(new URL(url).protocol))
    return Promise.reject(new Error("Use an HTTP or HTTPS download URL."));
  const target = path.resolve(destination);
  const existing = downloads.get(target);
  if (existing)
    return existing.url === url
      ? existing.promise
      : Promise.reject(new Error("Another download is writing this file."));
  const promise = transfer(url, target, options).finally(() => downloads.delete(target));
  downloads.set(target, { url, promise });
  return promise;
}

async function transfer(url: string, destination: string, options: DownloadOptions): Promise<void> {
  const partial = `${destination}.part`;
  const metadataFile = `${partial}.json`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  for (let attempt = 0; attempt < 4; attempt++) {
    options.signal?.throwIfAborted();
    const controller = new AbortController();
    let timer: NodeJS.Timeout;
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error("Download stalled for 60 seconds.")), 60000);
    };
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    let response: Response | undefined;
    try {
      let metadata: PartialMetadata | undefined;
      try {
        metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
      } catch {}
      let offset = 0;
      if (metadata?.url === url && metadata.validator) {
        try {
          offset = fs.statSync(partial).size;
        } catch {}
      }
      const headers: Record<string, string> = { "Accept-Encoding": "identity" };
      if (offset && metadata) {
        headers.Range = `bytes=${offset}-`;
        headers["If-Range"] = metadata.validator;
      }
      touch();
      response = await fetch(url, { headers, signal: controller.signal });
      if (!response.ok || !response.body) {
        if (response.status === 416) {
          // A finished partial is re-fetched to validate it before publishing.
          fs.rmSync(metadataFile, { force: true });
        }
        const error = new Error(`Download failed (${response.status}).`) as Error & { permanent?: boolean };
        error.permanent = response.status < 500 && ![408, 416, 429].includes(response.status);
        throw error;
      }
      if (response.headers.get("content-encoding") && response.headers.get("content-encoding") !== "identity")
        throw new Error("Server returned compressed bytes for a model download.");
      const range = response.headers.get("content-range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      const etag = response.headers.get("etag") || "";
      const validator = etag && !etag.startsWith("W/") ? etag : response.headers.get("last-modified") || "";
      if (
        response.status === 206 &&
        (!range || !offset || Number(range[1]) !== offset || validator !== metadata?.validator)
      ) {
        fs.rmSync(metadataFile, { force: true });
        throw new Error("Server returned an invalid resume range.");
      }
      if (response.status !== 206) offset = 0;
      const length = Number(response.headers.get("content-length") || 0);
      const total = range && response.status === 206 ? Number(range[3]) : length;
      const file = await fs.promises.open(partial, offset ? "a" : "w", 0o600);
      let received = offset;
      options.onProgress?.(received, total);
      try {
        fs.writeFileSync(metadataFile, JSON.stringify({ url, validator, total }), { mode: 0o600 });
        for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
          options.signal?.throwIfAborted();
          touch();
          // FileHandle.write can write fewer bytes than requested.
          let written = 0;
          while (written < bytes.length)
            written += (await file.write(bytes, written, bytes.length - written)).bytesWritten;
          received += bytes.length;
          options.onProgress?.(received, total);
        }
        if (!received || (total && received !== total) || (length && received - offset !== length))
          throw new Error("Incomplete download; retrying the remaining bytes.");
        await file.sync();
      } finally {
        await file.close();
      }
      if (options.sha256) {
        const hash = createHash("sha256");
        for await (const bytes of fs.createReadStream(partial)) hash.update(bytes);
        if (hash.digest("hex") !== options.sha256.toLowerCase()) {
          fs.rmSync(metadataFile, { force: true });
          throw new Error("Downloaded file checksum does not match.");
        }
      }
      options.signal?.throwIfAborted();
      fs.renameSync(partial, destination);
      fs.rmSync(metadataFile, { force: true });
      return;
    } catch (error) {
      options.signal?.throwIfAborted();
      if (attempt === 3 || (error as Error & { permanent?: boolean }).permanent) throw error;
      options.onRetry?.(attempt + 1);
      await delay(250 * 2 ** attempt, undefined, { signal: options.signal });
    } finally {
      clearTimeout(timer!);
      options.signal?.removeEventListener("abort", abort);
      try {
        await response?.body?.cancel();
      } catch {}
    }
  }
}
