import type { MenuItemConstructorOptions } from "electron";

export type RealtimeTrayCommand =
  | "passthrough-toggle"
  | "start"
  | "stop"
  | "mute"
  | "unmute"
  | "monitor-on"
  | "monitor-off";

export interface RealtimeTraySnapshot {
  connecting: boolean;
  streaming: boolean;
  model: string;
  processingMs: number;
  roundTripMs: number;
  muted: boolean;
  monitor: boolean;
}

export interface TrayState {
  available: boolean;
  engine: boolean;
  session: boolean;
  operation: "start" | "stop" | null;
  snapshot: RealtimeTraySnapshot | null;
  visible: boolean;
  alwaysOnTop: boolean;
}

export type TrayTranslate = (key: string, vars?: Record<string, string | number>) => string;

export function trayStatus(state: TrayState, t: TrayTranslate = (key) => key): string {
  if (state.operation === "stop") return t("Stopping realtime…");
  if (state.operation === "start" || state.snapshot?.connecting) return t("Starting realtime…");
  if (!state.available) return t("Service unavailable");
  if (state.engine && state.session && state.snapshot?.streaming) return t("Realtime active");
  if (state.session) return t("Connecting audio…");
  return state.engine ? t("Engine ready") : t("Realtime stopped");
}

export function canNavigateFromTray(state: TrayState): boolean {
  return !state.operation && !state.session && !state.snapshot?.streaming && !state.snapshot?.connecting;
}

export function trayMenu(
  state: TrayState,
  t: TrayTranslate,
  actions: {
    show: () => void;
    hide: () => void;
    navigate: (page: string) => void;
    realtime: (command: RealtimeTrayCommand) => void;
    alwaysOnTop: (enabled: boolean) => void;
    folder: (kind: "models" | "outputs" | "logs" | "preferences") => void;
    quit: () => void;
  },
): MenuItemConstructorOptions[] {
  const active = state.available && state.engine && state.session && state.snapshot?.streaming === true;
  const busy = state.operation !== null || state.snapshot?.connecting === true;
  const navigate = canNavigateFromTray(state);
  const page = (label: string, route: string): MenuItemConstructorOptions => ({
    label,
    enabled: navigate,
    click: () => actions.navigate(route),
  });
  const status: MenuItemConstructorOptions[] = [{ label: t(trayStatus(state)), enabled: false }];
  if (state.snapshot?.model)
    status.push({
      label: `${t("Voice model")}: ${state.snapshot.model.replace(/\\/g, "/").split("/").pop()}`,
      enabled: false,
    });
  if (active && state.snapshot)
    status.push(
      { label: `${t("Processing")}: ${Math.round(state.snapshot.processingMs)} ms`, enabled: false },
      { label: `${t("Round trip")}: ${Math.round(state.snapshot.roundTripMs)} ms`, enabled: false },
    );
  return [
    { label: `Applio · ${t(trayStatus(state))}`, enabled: false },
    { type: "separator" },
    { label: t("Open Applio"), click: actions.show },
    {
      label: t("Realtime"),
      submenu: [
        ...status,
        { type: "separator" },
        { label: t("Open Realtime"), click: () => actions.navigate("realtime") },
        {
          label: t("Start Realtime"),
          enabled: state.available && !busy && !state.session && !active,
          click: () => actions.realtime("start"),
        },
        {
          label: t("Stop Realtime"),
          enabled: !busy && (state.engine || state.session || active),
          click: () => actions.realtime("stop"),
        },
        { type: "separator" },
        {
          label: t("Mute microphone"),
          type: "checkbox",
          checked: active && state.snapshot?.muted,
          enabled: active && !busy,
          click: (item) => actions.realtime(item.checked ? "mute" : "unmute"),
        },
        {
          label: t("Local monitor"),
          type: "checkbox",
          checked: active && state.snapshot?.monitor,
          enabled: active && !busy,
          click: (item) => actions.realtime(item.checked ? "monitor-on" : "monitor-off"),
        },
      ],
    },
    {
      label: t("Studio"),
      submenu: [
        ...(!navigate ? [{ label: t("Stop realtime to switch pages"), enabled: false }] : []),
        page(t("Inference"), "inference"),
        page(t("Text to Speech"), "tts"),
        page(t("Audio Separator"), "audio-separator"),
        { type: "separator" },
        page(t("Models"), "models"),
        page(t("Training"), "train"),
        page(t("TensorBoard"), "tensorboard"),
        { type: "separator" },
        page(t("Jobs"), "jobs"),
        page(t("Extra"), "extra"),
      ],
    },
    {
      label: t("Window"),
      submenu: [
        { label: t("Open Applio"), click: actions.show },
        { label: t("Hide to tray"), enabled: state.visible, click: actions.hide },
        {
          label: t("Always on top"),
          type: "checkbox",
          checked: state.alwaysOnTop,
          click: (item) => actions.alwaysOnTop(item.checked),
        },
      ],
    },
    {
      label: t("Folders"),
      submenu: [
        { label: t("Voice models"), click: () => actions.folder("models") },
        { label: t("Audio outputs"), click: () => actions.folder("outputs") },
        { label: t("App logs"), click: () => actions.folder("logs") },
        { label: t("Preferences folder"), click: () => actions.folder("preferences") },
      ],
    },
    { type: "separator" },
    page(t("Settings"), "settings"),
    page(t("Report a problem"), "report"),
    { type: "separator" },
    { label: t("Quit Applio"), click: actions.quit },
  ];
}

export function parseTraySnapshot(value: unknown): RealtimeTraySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Record<string, unknown>;
  if (
    ["connecting", "streaming", "muted", "monitor"].some((key) => typeof s[key] !== "boolean") ||
    typeof s.model !== "string" ||
    s.model.length > 4096 ||
    [s.processingMs, s.roundTripMs].some(
      (n) => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 120000,
    )
  )
    return null;
  return {
    connecting: s.connecting as boolean,
    streaming: s.streaming as boolean,
    model: s.model,
    muted: s.muted as boolean,
    monitor: s.monitor as boolean,
    processingMs: s.processingMs as number,
    roundTripMs: s.roundTripMs as number,
  };
}

export function freshTraySnapshot(
  snapshot: RealtimeTraySnapshot | null,
  updatedAt: number,
  now = Date.now(),
): RealtimeTraySnapshot | null {
  return now - updatedAt < 10000 ? snapshot : null;
}
