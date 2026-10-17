export function jobHref(id: string): string {
  return `/jobs/view?id=${encodeURIComponent(id)}`;
}

export function normalizeJobHref(href: string): string {
  const match = /^\/jobs\/([^/?#]+)$/.exec(href);
  if (!match || match[1] === "view") return href;
  try {
    return jobHref(decodeURIComponent(match[1]));
  } catch {
    return "/jobs";
  }
}
