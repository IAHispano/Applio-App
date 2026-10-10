export async function waitFor(
  url: string,
  timeoutSeconds = 60,
  onTick?: (progressRatio: number) => void,
  intervalMs = 150,
): Promise<boolean> {
  const started = performance.now();
  const budget = Math.max(0, timeoutSeconds * 1000);
  const deadline = started + budget;
  while (performance.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(2000, deadline - performance.now())))),
      });
      await response.body?.cancel();
      if (response.ok) return true;
    } catch {
      /* service not ready yet */
    }
    onTick?.(Math.min(1, (performance.now() - started) / budget));
    const remaining = deadline - performance.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
  return false;
}
