// Typed client for the Express gateway (same-origin /api via Next.js rewrites).

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function cleanVersion(v?: string | null): string {
  if (!v) return "";
  const s = String(v).trim();
  if (!s) return "";
  // "unknown" is not a version — callers use "" to mean missing, and
  // displayVersion() renders it as "unknown" without a "v" prefix.
  if (s.toLowerCase() === "unknown" || s.toLowerCase() === "vunknown") return "";
  return s.replace(/^v+/i, "");
}

export function displayVersion(v?: string | null): string {
  if (v === undefined || v === null) return "";
  const raw = String(v).trim();
  if (!raw) return "";
  if (raw.toLowerCase() === "unknown" || raw.toLowerCase() === "vunknown") return "unknown";
  const c = cleanVersion(raw);
  return c ? `v${c}` : "";
}

export interface ModelLists {
  models: string[];
  indexes: string[];
  audios: string[];
}

export type JobStatus = "queued" | "running" | "done" | "error";

export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  logs: string[];
  result?: Record<string, unknown>;
  error?: string;
  outputFile?: string;
  progress?: number;
}

interface ApiErrorBody {
  error?: string;
}

interface CacheEntry {
  data?: unknown;
  timestamp: number;
  pending?: Promise<unknown>;
}
const apiCache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 200;

export function clearApiCache(pathPrefix?: string) {
  if (!pathPrefix) {
    apiCache.clear();
    return;
  }
  for (const key of apiCache.keys()) {
    if (key.startsWith(pathPrefix)) apiCache.delete(key);
  }
}

function invalidateFor(path: string) {
  if (path.includes("/models")) clearApiCache("/api/models");
  if (path.includes("/train")) clearApiCache("/api/train");
  if (path.includes("/settings")) clearApiCache("/api/settings");
  if (path.includes("/plugins")) clearApiCache("/api/plugins");
  if (path.includes("/download")) {
    clearApiCache("/api/models");
    clearApiCache("/api/train");
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
  if (!response.ok)
    throw new Error(body.error || `${init.method || "GET"} ${path} failed (${response.status})`);
  return body as T;
}

export async function apiGet<T>(
  path: string,
  options?: { ttlMs?: number; force?: boolean; signal?: AbortSignal },
): Promise<T> {
  const ttl = options?.ttlMs ?? (path.includes("/jobs") ? 0 : 30000);
  const init: RequestInit = { cache: "no-store", signal: options?.signal };
  // Live status and individually cancellable requests must remain independent.
  if (ttl <= 0 || options?.signal) return request<T>(path, init);

  const cached = apiCache.get(path);
  if (!options?.force && cached && "data" in cached && Date.now() - cached.timestamp < ttl) {
    return cached.data as T;
  }
  if (cached?.pending) return cached.pending as Promise<T>;

  const entry: CacheEntry = { timestamp: 0 };
  apiCache.delete(path);
  apiCache.set(path, entry);
  if (apiCache.size > MAX_CACHE_ENTRIES) {
    const oldest = apiCache.keys().next().value;
    if (oldest !== undefined) apiCache.delete(oldest);
  }
  entry.pending = request<T>(path, init).then(
    (data) => {
      // An invalidated or replaced request may finish, but cannot restore stale data.
      if (apiCache.get(path) === entry) {
        entry.data = data;
        entry.timestamp = Date.now();
        entry.pending = undefined;
      }
      return data;
    },
    (error) => {
      if (apiCache.get(path) === entry) apiCache.delete(path);
      throw error;
    },
  );
  return entry.pending as Promise<T>;
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  invalidateFor(path);
  try {
    return await request<T>(path, init);
  } finally {
    // Also discard reads started while the write was still in progress.
    invalidateFor(path);
  }
}

export function apiSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  return send(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function postForm<T>(path: string, fd: FormData): Promise<T> {
  return send(path, { method: "POST", body: fd });
}

export async function fetchModels(force = false): Promise<ModelLists> {
  return apiGet<ModelLists>("/api/models", { force });
}

export async function submitJob(path: string, body: unknown): Promise<{ jobId: string }> {
  if (typeof FormData !== "undefined" && body instanceof FormData) return postForm(path, body);
  return apiSend(path, "POST", body);
}

export async function submitInference(fd: FormData): Promise<{ jobId: string }> {
  return postForm("/api/inference", fd);
}

export async function fetchJob(id: string, signal?: AbortSignal): Promise<{ job: Job }> {
  return apiGet(`/api/jobs/${encodeURIComponent(id)}`, { signal });
}

export async function stopJob(id: string): Promise<void> {
  await apiSend(`/api/jobs/${id}/stop`, "POST");
}

export function pollJob(id: string, onUpdate: (job: Job) => void, intervalMs = 500): () => void {
  const controller = new AbortController();
  const deadline = Date.now() + 12 * 60 * 60 * 1000;
  let timer: ReturnType<typeof setTimeout>;
  const stop = () => {
    controller.abort();
    clearTimeout(timer);
  };
  const tick = async () => {
    try {
      const { job } = await fetchJob(id, controller.signal);
      if (controller.signal.aborted) return;
      onUpdate(job);
      if (isJobFinished(job)) stop();
    } catch {
      /* keep polling through transient proxy restarts */
    }
    // Schedule after the response so slow requests never accumulate.
    if (Date.now() >= deadline) stop();
    if (!controller.signal.aborted) timer = setTimeout(tick, intervalMs);
  };
  void tick();
  return stop;
}

function isJobFinished(job: Job): boolean {
  return job.status === "done" || job.status === "error";
}

// One transport at a time: stream while healthy, poll if absent or stalled.
export function watchJob(id: string, onUpdate: (job: Job) => void, onError: (error: unknown) => void) {
  const controller = new AbortController();
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout>;
  let stopPolling: (() => void) | undefined;
  const closeStream = () => {
    clearTimeout(timer);
    source?.close();
    source = null;
  };
  const fallback = (intervalMs = 500) => {
    closeStream();
    if (!controller.signal.aborted && !stopPolling) stopPolling = pollJob(id, onUpdate, intervalMs);
  };
  fetchJob(id, controller.signal)
    .then(({ job }) => {
      if (controller.signal.aborted) return;
      onUpdate(job);
      if (isJobFinished(job)) return;
      const apiBase = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/+$/, "");
      try {
        source = new EventSource(`${apiBase}/api/jobs/${encodeURIComponent(id)}/events`);
        source.onmessage = (event) => {
          if (controller.signal.aborted || !source) return;
          try {
            const { job: update } = JSON.parse(event.data) as { job: Job };
            if (!update || update.id !== id) return;
            onUpdate(update);
            if (isJobFinished(update)) {
              closeStream();
              return;
            }
            clearTimeout(timer);
            // Quiet jobs need only the same five-second check as the watchdog.
            timer = setTimeout(() => fallback(5000), 5000);
          } catch {
            /* malformed chunks do not postpone the fallback */
          }
        };
        source.onerror = () => {
          if (source) fallback();
        };
        timer = setTimeout(fallback, 4000);
      } catch {
        fallback();
      }
    })
    .catch((error) => {
      if (!controller.signal.aborted) onError(error);
    });
  return () => {
    controller.abort();
    closeStream();
    stopPolling?.();
  };
}

export function fileBasename(p: string): string {
  if (!p) return "";
  return p.split(/[\\/]/).pop() || p;
}

export function outputUrl(rel: string): string {
  if (!rel) return "";
  const name = fileBasename(rel);
  return `/outputs/${encodeURIComponent(name)}`;
}

export function isAudioFile(rel: string): boolean {
  return [".wav", ".mp3", ".flac", ".ogg", ".m4a", ".opus"].some((e) => rel.toLowerCase().endsWith(e));
}

export function isImageFile(rel: string): boolean {
  return [".png", ".jpg", ".jpeg"].some((e) => rel.toLowerCase().endsWith(e));
}

export function resolveAudioUrl(input: string): string {
  if (!input) return "";
  if (
    input.startsWith("blob:") ||
    input.startsWith("http://") ||
    input.startsWith("https://") ||
    input.startsWith("data:")
  ) {
    return input;
  }
  const clean = input.replace(/^[\\/]+/, "").replace(/\\/g, "/");
  if (clean.startsWith("assets/") || clean.startsWith("outputs/")) {
    return `/${clean}`;
  }
  return `/api/audio/raw?path=${encodeURIComponent(input)}`;
}
