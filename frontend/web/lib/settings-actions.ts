/** Wait for a new engine generation, rather than reporting a request as a restart. */
export async function restartApiAndWait(): Promise<void> {
  const deadline = Date.now() + 45000;
  const response = await fetch("/api/settings/restart", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not restart API.");
  if (typeof body.instanceId !== "string") throw new Error("API restart could not be verified.");
  await waitForApiGeneration(body.instanceId, undefined, deadline);
}

export async function waitForApiGeneration(
  previousInstance: string,
  signal?: AbortSignal,
  deadline = Date.now() + 45000,
): Promise<void> {
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason;
    const request = new AbortController();
    const abort = () => request.abort();
    const timeout = setTimeout(abort, 2000);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const health = await fetch("/api/health", { cache: "no-store", signal: request.signal });
      if (health.ok) {
        const status = await health.json();
        if (status.ok && typeof status.instanceId === "string" && status.instanceId !== previousInstance)
          return;
      }
    } catch {
      // Connections can briefly fail while the old generation is draining.
      if (signal?.aborted) throw signal.reason;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("API restart timed out. Please restart Applio.");
}

/** Serialize preference writes and keep later changes saveable after a failed request. */
export function createSettingsSaveQueue<Patch, Result>(write: (patch: Patch) => Promise<Result>) {
  let pending: Promise<unknown> = Promise.resolve();
  return (patch: Patch): Promise<Result> => {
    const result = pending.then(() => write(patch));
    pending = result.catch(() => undefined);
    return result;
  };
}
