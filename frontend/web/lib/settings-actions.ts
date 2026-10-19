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
  while (Date.now() < deadline) {
    try {
      const health = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(2000) });
      if (health.ok) {
        const status = await health.json();
        if (status.ok && typeof status.instanceId === "string" && status.instanceId !== body.instanceId)
          return;
      }
    } catch {
      // Connections can briefly fail while the old generation is draining.
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
