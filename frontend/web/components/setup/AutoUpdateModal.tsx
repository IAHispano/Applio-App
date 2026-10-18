"use client";

import { ArrowDownCircle, RefreshCw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReleaseChanges from "@/components/ReleaseChanges";
import { Button, Dialog, IconButton } from "@/components/ui";
import ProgressBar from "@/components/ui/ProgressBar";
import { apiGet, apiSend, displayVersion, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  type DesktopUpdaterState,
  deferUpdate,
  desktopUpdater,
  updateIsDeferred,
  type VersionCheckData,
} from "@/lib/update-policy";

export default function AutoUpdateModal() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<VersionCheckData | null>(null);
  const [native, setNative] = useState<DesktopUpdaterState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const checking = useRef(false);
  const manualRequested = useRef(false);
  const starting = useRef(false);
  const versionRef = useRef<VersionCheckData | null>(null);

  const checkForUpdates = useCallback(async (manual = false) => {
    if (checking.current) {
      if (manual) manualRequested.current = true;
      return;
    }
    if (!manual && process.env.NODE_ENV === "development") return;
    checking.current = true;
    try {
      const updater = desktopUpdater();
      const [metadata, status] = await Promise.allSettled([
        apiGet<VersionCheckData>(`/api/settings/version-check${manual ? "?refresh=1" : ""}`, { ttlMs: 0 }),
        updater?.check(),
      ]);
      const data = metadata.status === "fulfilled" ? metadata.value : null;
      const state = status.status === "fulfilled" ? status.value : undefined;
      if (state) setNative(state);
      if (!manual && !manualRequested.current && (data?.isDev || state?.status === "dev-mode")) return;
      const available = state?.status === "available" || state?.status === "downloaded";
      const candidate =
        available && state?.version
          ? {
              local: data?.local || "",
              latest: state.version,
              status: "behind" as const,
              versionsBehind: 1,
              isOutdated: false,
              releaseNotes:
                state.releaseNotes ||
                (data?.latest.replace(/^v/, "") === state.version.replace(/^v/, "")
                  ? data.releaseNotes
                  : undefined),
            }
          : data?.status === "behind"
            ? data
            : manual || manualRequested.current
              ? versionRef.current
              : null;
      if (!candidate) return;
      versionRef.current = candidate;
      setVersion(candidate);
      if (manual || manualRequested.current || !updateIsDeferred(candidate.latest)) {
        setError("");
        setMessage("");
        setOpen(true);
      }
    } finally {
      checking.current = false;
      manualRequested.current = false;
    }
  }, []);

  useEffect(() => {
    const updater = desktopUpdater();
    return updater?.onStatusChange((state) => {
      setNative(state);
      if (state.status === "error") setError(state.message || t("Download failed"));
    });
  }, [t]);

  useEffect(() => {
    const show = () => {
      void checkForUpdates(true);
    };
    const timer = setTimeout(() => {
      void checkForUpdates();
    }, 1200);
    const interval = setInterval(() => {
      void checkForUpdates();
    }, 3600000);
    window.addEventListener("applio:show-update", show);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("applio:show-update", show);
    };
  }, [checkForUpdates]);

  async function startUpdate() {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setError("");
    setMessage(t("Starting update…"));
    try {
      const updater = desktopUpdater();
      if (updater) {
        let state = await updater.getStatus();
        if (state.status !== "dev-mode") {
          if (state.status !== "available" && state.status !== "downloaded") state = await updater.check();
          if (state.status === "available") state = await updater.download();
          setNative(state);
          if (state.status !== "downloaded") throw new Error(state.message || t("Download failed"));
          setMessage(t("Update ready to install. Restart when you are ready."));
          return;
        }
      }
      const result = await apiSend<{
        success: boolean;
        method: string;
        message?: string;
        downloadUrl?: string;
      }>("/api/settings/apply-update", "POST");
      if (result.success && result.method === "git") {
        setMessage(t("Repository updated. Rebuild and restart the application to load the new version."));
      } else {
        const url = result.downloadUrl || versionRef.current?.downloadUrl;
        if (!url) throw new Error(result.message || t("Download failed"));
        window.open(url, "_blank", "noopener,noreferrer");
        setMessage(t("Installer opened in your browser. Run the installer to complete the update."));
      }
    } catch (cause) {
      setMessage("");
      setError(errMsg(cause));
    } finally {
      starting.current = false;
      setBusy(false);
    }
  }

  async function installUpdate() {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setError("");
    try {
      const updater = desktopUpdater();
      if (!updater) throw new Error(t("Desktop updater is unavailable."));
      await updater.quitAndInstall();
    } catch (cause) {
      setError(errMsg(cause));
    } finally {
      starting.current = false;
      setBusy(false);
    }
  }

  function close() {
    if (version && !busy) deferUpdate(version.latest);
    setOpen(false);
  }

  if (!open || !version) return null;
  const downloading = busy || native?.status === "downloading";
  const ready = native?.status === "downloaded";
  return (
    <Dialog
      isOpen
      onClose={close}
      aria-labelledby="update-modal-title"
      className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-xl"
    >
      <div className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--panel)] text-[var(--text)] p-5 sm:p-6 space-y-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <h2 id="update-modal-title" className="flex items-center gap-2 text-lg font-semibold m-0">
              <Sparkles size={20} aria-hidden="true" />
              {t("Applio Update Available")}
            </h2>
            <p className="text-xs text-[var(--muted)] m-0">
              {t("Current:")} {displayVersion(version.local)} · {t("Latest:")}{" "}
              {displayVersion(version.latest)}
            </p>
          </div>
          <IconButton size="md" icon={<X size={16} />} label={t("Close")} onClick={close} />
        </div>
        <p className="text-sm leading-relaxed m-0">
          {t(
            "We recommend updating for the latest fixes, improvements, and features. You choose when to update.",
          )}
        </p>
        <ReleaseChanges
          local={version.local}
          latest={version.latest}
          notes={version.releaseNotes || native?.releaseNotes}
        />
        {native?.status === "downloading" && (
          <ProgressBar progress={native.percent} label={t("Downloading update…")} />
        )}
        {message && (
          <p role="status" className="text-xs leading-relaxed m-0">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-400 m-0">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <Button variant="ghost" size="md" onClick={close}>
            {downloading ? t("Hide") : t("Remind me with the next update")}
          </Button>
          <Button
            size="md"
            loading={downloading}
            onClick={() => void (ready ? installUpdate() : startUpdate())}
            icon={ready ? <RefreshCw size={14} /> : <ArrowDownCircle size={14} />}
          >
            {ready ? t("Restart and Update") : t("Update")}
          </Button>
        </div>
        <p className="text-xs text-[var(--muted)] m-0">
          {t("You can update anytime from Settings → Version & Updates.")}
        </p>
      </div>
    </Dialog>
  );
}
