/** Parse tqdm metadata independently of the terminal width or fill characters. */
export function parseLogProgress(line: string) {
  const match = line.match(/^(.*?)\s*(\d{1,3}(?:\.\d+)?)%\s*\|[^|]*\|\s*([^[]*)\[([^\]]*)\]/);
  if (!match) return null;
  return {
    description: match[1].trim().replace(/:\s*$/, ""),
    percent: Math.max(0, Math.min(100, Number(match[2]))),
    detail: [match[3].trim(), match[4].trim()].filter(Boolean).join(" · "),
  };
}

/** Current batch bars and legacy per-batch log messages share these counters. */
export function parseTrainingProgress(line: string) {
  const bar = line.match(
    /^epoch=(\d+)\s*\|\s*step=(\d+)\s*\|\s*\d{1,3}(?:\.\d+)?%\s*\|[^|]*\|\s*batch=(\d+)\/(\d+)\s*\[/,
  );
  if (bar) {
    return { epoch: Number(bar[1]), step: Number(bar[2]), current: Number(bar[3]), total: Number(bar[4]) };
  }
  const legacy = line.match(
    /^(.+?)\s*\|\s*epoch=(\d+)\s*\|\s*step=(\d+)\s*\|\s*batch=\s*(\d+)\s*\/\s*(\d+)(?:\s*\|\s*\d{1,3}(?:\.\d+)?%\s*\||\s*$)/,
  );
  return legacy
    ? {
        epoch: Number(legacy[2]),
        step: Number(legacy[3]),
        current: Number(legacy[4]),
        total: Number(legacy[5]),
      }
    : null;
}
