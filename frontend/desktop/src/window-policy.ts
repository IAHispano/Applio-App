import type { Input, WebContents } from "electron";

export const APP_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  devTools: false,
} as const;

export function isBrowserShortcut(input: Pick<Input, "key" | "control" | "meta" | "shift" | "alt">): boolean {
  const key = input.key.toLowerCase();
  if (key === "f12" || key === "f5") return true;
  const primary = input.control || input.meta;
  if (primary && (key === "u" || key === "r")) return true;
  return (
    (primary && input.shift && ["i", "j", "c", "k"].includes(key)) ||
    (input.meta && input.alt && ["i", "j", "c", "u"].includes(key))
  );
}

export function restrictBrowserControls(contents: WebContents, openExternal?: (url: string) => void): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) openExternal?.(url);
    return { action: "deny" };
  });
  contents.on("before-input-event", (event, input) => {
    if (isBrowserShortcut(input)) event.preventDefault();
  });
  contents.on("context-menu", (event) => event.preventDefault());
  contents.on("devtools-opened", () => contents.closeDevTools());
  // Deny browser-internal URLs and dropped documents while allowing app routes.
  contents.on("will-navigate", (event, url) => {
    if (!isAppNavigation(contents.getURL(), url)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) openExternal?.(url);
    }
  });
  contents.on("will-frame-navigate", (event) => {
    // TensorBoard is embedded from its own local HTTP service.
    if (
      event.isMainFrame ? !isAppNavigation(contents.getURL(), event.url) : !/^https?:\/\//i.test(event.url)
    ) {
      event.preventDefault();
    }
  });
}

export function isAppNavigation(current: string, destination: string): boolean {
  try {
    const from = new URL(current);
    const to = new URL(destination);
    return ["http:", "https:"].includes(to.protocol) && from.origin === to.origin;
  } catch {
    return false;
  }
}
