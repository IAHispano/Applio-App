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
