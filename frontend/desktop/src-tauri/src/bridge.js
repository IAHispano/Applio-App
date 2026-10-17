// Installed before the React UI loads. Browser and remote Bridge Mode pages
// never receive this object. Keep the established frontend contract stable.
(() => {
  if (location.origin !== "http://127.0.0.1:3000") return;
  const invoke = (command, args = {}) => window.__TAURI__.core.invoke(command, args);
  const listen = (name, callback) => {
    let disposed = false,
      unlisten;
    window.__TAURI__.event
      .listen(name, (event) => callback(event.payload))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(console.error);
    return () => {
      disposed = true;
      unlisten?.();
    };
  };
  const action = (action) => invoke("window_action", { action });
  const bridge = (action, value) => invoke("bridge_command", { action, value });
  const update = (action) => invoke("updater_command", { action });
  window.applio = Object.freeze({
    platform: __APPLIO_PLATFORM__,
    versions: { tauri: "2", rust: true },
    controls: {
      minimize: () => void action("minimize"),
      toggleMaximize: () => void action("toggle-maximize"),
      toggleFullscreen: () => void action("toggle-fullscreen"),
      close: () => void action("close"),
      isMaximized: () => action("is-maximized"),
      isFullscreen: () => action("is-fullscreen"),
      onMaximizeChanged: (callback) => listen("window-maximize-changed", callback),
    },
    bridgeMode: {
      getStatus: () => bridge("status"),
      start: () => bridge("start"),
      stop: () => bridge("stop"),
      newInvite: () => bridge("invite"),
      copyInvite: () => bridge("copy-invite"),
      approve: (id) => bridge("approve", id),
      revoke: (id) => bridge("revoke", id),
    },
    chooseFolder: (defaultPath) => invoke("choose_folder", { defaultPath }),
    restartAfterSetup: (jobId) => invoke("restart_after_setup", { jobId }),
    showJobNotification: (value) => invoke("notify_job", { value }),
    onNavigate: (callback) => listen("app-navigate", callback),
    onJobOpen: (callback) => listen("job-open", callback),
    onRealtimeCommand: (callback) => listen("realtime-command", callback),
    setPassthroughHotkey: (accelerator) => invoke("set_passthrough_hotkey", { accelerator }),
    reportRealtimeState: (stateValue) =>
      void invoke("report_realtime_state", { stateValue }).catch(console.error),
    updater: {
      getStatus: () => update("status"),
      check: () => update("check"),
      download: () => update("download"),
      quitAndInstall: () => void update("install").catch(console.error),
      onStatusChange: (callback) => listen("updater-status", callback),
    },
  });
  document.addEventListener("DOMContentLoaded", () => {
    document.documentElement.dataset.applioDesktop = "true";
  });
  // WebView2 and WKWebView open links through the OS browser. Native navigation
  // is also restricted by the Rust window's navigation callback.
  document.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest?.("a[href]");
      if (!link) return;
      const url = new URL(link.href, location.href);
      if (/^https?:$/.test(url.protocol) && url.origin !== location.origin) {
        event.preventDefault();
        void invoke("window_action", { action: "open-external", url: url.href });
      }
    },
    true,
  );
  window.open = (url) => {
    if (url) void invoke("window_action", { action: "open-external", url: String(url) }).catch(console.error);
    return null;
  };
})();
