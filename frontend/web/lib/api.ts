// Typed client for the Rust API (same-origin /api via Next.js rewrites).

export function errMsg(err: unknown): string {
  if (err instanceof Error) {
    const details = (err as unknown as { details?: string }).details;
    if (details && !err.message.includes(details)) {
      return `${err.message}\n${details}`;
    }
    return err.message;
  }
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.error === "string") return obj.error;
    if (typeof obj.message === "string") return obj.message;
  }
  return String(err);
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
  label?: string;
  id: string;
  type: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  params?: Record<string, unknown>;
  finishedAt?: string;
  logs: string[];
  result?: Record<string, unknown>;
  error?: string;
  errorDetails?: string;
  outputFile?: string;
  stage?: string;
  stageCurrent?: number;
  stageTotal?: number;
  progress?: number;
}

interface ApiErrorBody {
  error?: string;
  details?: unknown;
}

// The API answers validation failures with a structured body
// ({ formErrors, fieldErrors }); flatten it so the message is readable
// instead of "[object Object]".
function formatDetails(details: unknown): string {
  if (typeof details === "string") return details;
  if (!details || typeof details !== "object") return "";
  const body = details as { formErrors?: unknown; fieldErrors?: unknown };
  const parts: string[] = [];
  if (Array.isArray(body.formErrors)) {
    for (const message of body.formErrors) parts.push(String(message));
  }
  if (body.fieldErrors && typeof body.fieldErrors === "object") {
    for (const [field, errors] of Object.entries(body.fieldErrors as Record<string, unknown>)) {
      const list = Array.isArray(errors) ? errors.map(String) : [String(errors)];
      parts.push(`${field}: ${list.join(", ")}`);
    }
  }
  return parts.join("; ");
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
  // "/api/uvr/custom-models" also contains "/models", so the UVR paths are
  // matched first and kept out of the voice-model branch.
  if (path.includes("/api/uvr")) {
    clearApiCache("/api/uvr");
  } else if (path.includes("/models") && !["/api/models/preload", "/api/models/inspect"].includes(path)) {
    clearApiCache("/api/models");
  }
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
  if (!response.ok) {
    const errorMsg = body.error || `${init.method || "GET"} ${path} failed (${response.status})`;
    const err = new Error(errorMsg);
    const details = formatDetails(body.details);
    if (details) {
      (err as Error & { details?: string }).details = details;
    }
    throw err;
  }
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

  return cachedRequest(path, ttl, options?.force, () => request<T>(path, init));
}

function cachedRequest<T>(
  path: string,
  ttl: number,
  force: boolean | undefined,
  load: () => Promise<T>,
): Promise<T> {
  const cached = apiCache.get(path);
  if (!force && cached && "data" in cached && Date.now() - cached.timestamp < ttl) {
    return Promise.resolve(cached.data as T);
  }
  if (cached?.pending) return cached.pending as Promise<T>;

  const entry: CacheEntry = { timestamp: 0 };
  apiCache.delete(path);
  apiCache.set(path, entry);
  if (apiCache.size > MAX_CACHE_ENTRIES) {
    const oldest = apiCache.keys().next().value;
    if (oldest !== undefined) apiCache.delete(oldest);
  }
  entry.pending = load().then(
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

export function peekApiCache<T>(path: string): T | undefined {
  return apiCache.get(path)?.data as T | undefined;
}
const inspectionKey = (pthPath: string) => `/api/models/inspect?pthPath=${encodeURIComponent(pthPath)}`;
export function cachedModelInspection<T>(pthPath: string): T | undefined {
  return peekApiCache<T>(inspectionKey(pthPath));
}
export function inspectModel<T>(pthPath: string, force = false): Promise<T> {
  return cachedRequest(inspectionKey(pthPath), 30000, force, () =>
    request<T>("/api/models/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pthPath }),
    }),
  );
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

let modelSnapshot: ModelLists | undefined;
const modelListeners = new Set<(models: ModelLists) => void>();
export const cachedModels = () => modelSnapshot;
export function onModelsChanged(listener: (models: ModelLists) => void) {
  modelListeners.add(listener);
  if (modelSnapshot) listener(modelSnapshot);
  return () => {
    modelListeners.delete(listener);
  };
}
export async function fetchModels(force = false): Promise<ModelLists> {
  const models = await apiGet<ModelLists>("/api/models", { force });
  if (modelSnapshot !== models) {
    modelSnapshot = models;
    for (const listener of modelListeners) listener(models);
  }
  return models;
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
  const keepStreamAlive = () => {
    clearTimeout(timer);
    // The server sends a heartbeat every 15 seconds even when a job is quiet.
    // Allow two missed heartbeats before falling back to HTTP polling.
    timer = setTimeout(() => fallback(5000), 45000);
  };
  fetchJob(id, controller.signal)
    .then(({ job }) => {
      if (controller.signal.aborted) return;
      onUpdate(job);
      if (isJobFinished(job)) return;
      try {
        if (sessionStorage.getItem("applio:remote-bridge") === "1") {
          fallback();
          return;
        }
      } catch {
        /* storage may be unavailable; the stream error still falls back */
      }
      const apiBase = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/+$/, "");
      try {
        source = new EventSource(`${apiBase}/api/jobs/${encodeURIComponent(id)}/events`);
        source.addEventListener("heartbeat", keepStreamAlive);
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
            keepStreamAlive();
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
