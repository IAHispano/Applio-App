import { contextBridge, ipcRenderer } from "electron";

export interface WindowControls {
  minimize: () => void;
  toggleMaximize: () => void;
  toggleFullscreen: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  onMaximizeChanged: (cb: (maximized: boolean) => void) => () => void;
}

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string; releaseDate?: string }
  | { status: "not-available"; version: string }
  | { status: "downloading"; percent: number; bytesPerSecond: number; total: number; transferred: number }
  | { status: "downloaded"; version: string; releaseNotes?: string }
  | { status: "error"; message: string }
  | { status: "dev-mode"; message: string };

export interface UpdaterBridge {
  getStatus: () => Promise<UpdateState>;
  check: () => Promise<unknown>;
  download: () => Promise<unknown>;
  quitAndInstall: () => void;
  onStatusChange: (cb: (state: UpdateState) => void) => () => void;
}

export interface ApplioBridge {
  platform: NodeJS.Platform;
  versions: NodeJS.ProcessVersions;
  controls: WindowControls;
  updater: UpdaterBridge;
}

declare global {
  interface Window {
    applio?: ApplioBridge;
  }
}

contextBridge.exposeInMainWorld("applio", {
  platform: process.platform,
  versions: process.versions,
  controls: {
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    toggleFullscreen: () => ipcRenderer.send("window:toggle-fullscreen"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    isFullscreen: () => ipcRenderer.invoke("window:is-fullscreen"),
    onMaximizeChanged: (cb: (maximized: boolean) => void) => {
      const listener = (_event: unknown, value: unknown) => cb(value === true);
      ipcRenderer.on("window:maximize-changed", listener);
      return () => ipcRenderer.removeListener("window:maximize-changed", listener);
    },
  },
  updater: {
    getStatus: () => ipcRenderer.invoke("updater:get-status"),
    check: () => ipcRenderer.invoke("updater:check"),
    download: () => ipcRenderer.invoke("updater:download"),
    quitAndInstall: () => ipcRenderer.send("updater:quit-and-install"),
    onStatusChange: (cb: (state: UpdateState) => void) => {
      const listener = (_event: unknown, state: UpdateState) => cb(state);
      ipcRenderer.on("updater:status", listener);
      return () => ipcRenderer.removeListener("updater:status", listener);
    },
  },
} satisfies ApplioBridge);
