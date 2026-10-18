export const DEFERRED_UPDATE_KEY = "applio:update-deferred-version";

export interface VersionCheckData {
  local: string;
  latest: string;
  status: "up-to-date" | "behind" | "ahead" | "unknown";
  versionsBehind: number;
  isOutdated: boolean;
  isDev?: boolean;
  releaseNotes?: string;
  htmlUrl?: string;
  downloadUrl?: string;
}

export interface DesktopUpdaterState {
  status:
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error"
    | "dev-mode";
  version?: string;
  percent?: number;
  message?: string;
  releaseNotes?: string;
}

export interface DesktopUpdater {
  getStatus: () => Promise<DesktopUpdaterState>;
  check: () => Promise<DesktopUpdaterState>;
  download: () => Promise<DesktopUpdaterState>;
  quitAndInstall: () => Promise<unknown>;
  onStatusChange: (callback: (state: DesktopUpdaterState) => void) => () => void;
}

export function desktopUpdater(): DesktopUpdater | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { applio?: { updater?: DesktopUpdater } }).applio?.updater;
}

function normalized(version: string): string {
  return version.trim().replace(/^[vV]/, "");
}

export function shouldPromptForUpdate(latest: string, deferred: string | null): boolean {
  return !!latest && (!deferred || normalized(latest) !== normalized(deferred));
}

export function updateIsDeferred(latest: string): boolean {
  try {
    return !shouldPromptForUpdate(latest, localStorage.getItem(DEFERRED_UPDATE_KEY));
  } catch {
    return false;
  }
}

export function deferUpdate(version: string): void {
  try {
    localStorage.setItem(DEFERRED_UPDATE_KEY, normalized(version));
  } catch {
    // Storage can be disabled; the current dialog still closes.
  }
}

export function releaseLinks(repository: string, local: string, latest: string) {
  const version = (value: string) => {
    const clean = normalized(value);
    return /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(clean) ? `v${clean}` : null;
  };
  const from = version(local);
  const to = version(latest);
  return {
    release: to ? `${repository}/releases/tag/${encodeURIComponent(to)}` : `${repository}/releases`,
    compare:
      from && to && from !== to
        ? `${repository}/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}`
        : null,
  };
}

/** Render release Markdown as text and explicit links, without trusting HTML. */
export function releaseNoteParts(
  line: string,
  repository: string,
): { key: string; text: string; href?: string }[] {
  const parts: { key: string; text: string; href?: string }[] = [];
  const links = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let offset = 0;
  for (const match of line.matchAll(links)) {
    if (match.index > offset) parts.push({ key: `text-${offset}`, text: line.slice(offset, match.index) });
    const text = match[1].replace(/^`|`$/g, "");
    parts.push({
      key: `link-${match.index}`,
      text,
      ...(match[2].startsWith(`${repository}/`) ? { href: match[2] } : {}),
    });
    offset = match.index + match[0].length;
  }
  if (offset < line.length) parts.push({ key: `text-${offset}`, text: line.slice(offset) });
  return parts;
}
