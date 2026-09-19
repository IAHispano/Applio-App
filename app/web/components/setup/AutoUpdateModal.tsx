"use client";

import {
  AlertTriangle,
  ArrowDownCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiSend, cleanVersion, displayVersion, errMsg } from "../../lib/api";
import { useI18n } from "../../lib/i18n";

export interface VersionCheckData {
  local: string;
  latest: string;
  status: "up-to-date" | "behind" | "ahead";
  versionsBehind: number;
  isOutdated: boolean;
  isDev?: boolean;
  releaseName?: string;
  releaseNotes?: string;
  publishedAt?: string;
  htmlUrl?: string;
  downloadUrl?: string;
}

interface DesktopUpdaterState {
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

const UPDATE_POSTPONED_SESSION_KEY = "applio:update-postponed-version";

export default function AutoUpdateModal() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [versionData, setVersionData] = useState<VersionCheckData | null>(null);
  const [, setUpdaterState] = useState<DesktopUpdaterState | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateStep, setUpdateStep] = useState<"idle" | "downloading" | "ready" | "done" | "error">("idle");
  const [updateProgress, setUpdateProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const autoTriggeredRef = useRef(false);

  // Desktop bridge reference
  const getBridge = useCallback(() => {
    if (typeof window === "undefined") return null;
    return (
      window as unknown as {
        applio?: {
          updater?: {
            getStatus: () => Promise<DesktopUpdaterState>;
            check: () => Promise<unknown>;
            download?: () => Promise<unknown>;
            quitAndInstall: () => void;
            onStatusChange: (cb: (s: DesktopUpdaterState) => void) => () => void;
          };
        };
      }
    ).applio;
  }, []);

  // Update installation handler
  const startUpdate = useCallback(async () => {
    setUpdating(true);
    setErrorMsg("");
    setUpdateStep("downloading");
    setStatusMessage(t("Starting update…"));

    const bridge = getBridge();

    // 1. If Electron Desktop updater is available and functional
    if (bridge?.updater) {
      try {
        const currentStatus = await bridge.updater.getStatus();
        if (currentStatus.status === "downloaded") {
          setUpdateStep("ready");
          setStatusMessage(t("Update downloaded. Restarting Applio…"));
          setTimeout(() => {
            bridge.updater?.quitAndInstall();
          }, 1200);
          return;
        }

        // Trigger download if available
        if (bridge.updater.download) {
          await bridge.updater.download();
        } else {
          await bridge.updater.check();
        }
        setStatusMessage(t("Downloading update in background…"));
        return;
      } catch {
        // Fallback to git / API update below if desktop updater fails
      }
    }

    // 2. Web / Git / API fallback updater
    try {
      setStatusMessage(t("Applying update via repository…"));
      setUpdateProgress(35);
      const res = await apiSend<{
        success: boolean;
        method: string;
        version?: string;
        message?: string;
        downloadUrl?: string;
      }>("/api/settings/apply-update", "POST");

      setUpdateProgress(100);
      if (res.success && res.method === "git") {
        setUpdateStep("done");
        setStatusMessage(t("Applio updated successfully! Restart the application to load the new version."));
      } else if (res.downloadUrl || versionData?.downloadUrl) {
        const url = res.downloadUrl || versionData?.downloadUrl;
        if (url && typeof window !== "undefined") {
          window.open(url, "_blank");
        }
        setUpdateStep("ready");
        setStatusMessage(t("Installer opened in your browser. Run the installer to complete the update."));
      } else {
        setUpdateStep("done");
        setStatusMessage(res.message || t("Update completed."));
      }
    } catch (err) {
      setUpdateStep("error");
      setErrorMsg(errMsg(err));
      setUpdating(false);
    }
  }, [getBridge, t, versionData?.downloadUrl]);

  // Check version on startup
  const checkForUpdates = useCallback(async () => {
    // 1. Disable update modal completely in development mode
    if (process.env.NODE_ENV === "development") {
      return;
    }

    // 2. Disable in desktop Electron dev-mode
    const bridge = getBridge();
    if (bridge?.updater) {
      try {
        const st = await bridge.updater.getStatus();
        if (st?.status === "dev-mode") {
          return;
        }
      } catch {
        /* non-fatal */
      }
    }

    try {
      // Fetch version check from API
      const data = await apiGet<VersionCheckData>("/api/settings/version-check", {
        force: true,
      });

      // 3. Disable if API reports dev environment
      if (data.isDev) {
        return;
      }

      setVersionData(data);

      if (data.status === "behind") {
        const postponedVersion =
          typeof sessionStorage !== "undefined" ? sessionStorage.getItem(UPDATE_POSTPONED_SESSION_KEY) : null;

        // If postponed in this session, do not show
        if (postponedVersion && cleanVersion(postponedVersion) === cleanVersion(data.latest)) {
          return;
        }

        // Show update modal
        setOpen(true);

        // If the user is running a few updates older, auto-trigger update
        if (data.isOutdated) {
          if (!autoTriggeredRef.current) {
            autoTriggeredRef.current = true;
            // Short delay to let modal render and show notice
            setTimeout(() => {
              void startUpdate();
            }, 800);
          }
        }
      }
    } catch {
      /* non-fatal if offline */
    }

    // Connect desktop updater listener if running inside Electron
    if (bridge?.updater) {
      bridge.updater
        .getStatus()
        .then((st) => {
          if (st) setUpdaterState(st);
        })
        .catch(() => {});

      bridge.updater.onStatusChange((st) => {
        setUpdaterState(st);
        if (st.status === "downloading") {
          setUpdating(true);
          setUpdateStep("downloading");
          setUpdateProgress(st.percent ?? 0);
          setStatusMessage(`${t("Downloading update…")} ${st.percent ?? 0}%`);
        } else if (st.status === "downloaded") {
          setUpdating(false);
          setUpdateStep("ready");
          setStatusMessage(t("Update ready to install."));
          // If critical outdated, restart to apply
          if (versionData?.isOutdated) {
            setTimeout(() => {
              bridge.updater?.quitAndInstall();
            }, 1500);
          }
        } else if (st.status === "error") {
          setUpdating(false);
          setUpdateStep("error");
          setErrorMsg(st.message || t("Download failed"));
        }
      });

      // Trigger check
      bridge.updater.check().catch(() => {});
    }
  }, [getBridge, startUpdate, t, versionData?.isOutdated]);

  useEffect(() => {
    // Never run auto-update timer in development mode
    if (process.env.NODE_ENV === "development") return;

    const timer = setTimeout(() => {
      void checkForUpdates();
    }, 1200);

    return () => clearTimeout(timer);
  }, [checkForUpdates]);

  const handleClose = useCallback(() => {
    try {
      if (versionData?.latest) {
        sessionStorage.setItem(UPDATE_POSTPONED_SESSION_KEY, versionData.latest);
      }
    } catch {
      /* non-fatal */
    }
    setOpen(false);
  }, [versionData?.latest]);

  // Handle escape key to close modal
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  const handleRestartNow = () => {
    const bridge = getBridge();
    if (bridge?.updater) {
      bridge.updater.quitAndInstall();
    } else if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  if (!open || !versionData || versionData.status !== "behind") return null;

  const isOutdated = versionData.isOutdated;
  const versionsBehind = versionData.versionsBehind || 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-modal-title"
      className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200"
    >
      {/* Backdrop click to dismiss */}
      <button
        type="button"
        aria-label={t("Close")}
        onClick={handleClose}
        className="absolute inset-0 w-full h-full bg-transparent border-0 cursor-default p-0 -z-10 focus:outline-none"
        tabIndex={-1}
      />

      <div
        className={`relative w-full max-w-lg rounded-2xl border ${
          isOutdated ? "border-red-500/30 shadow-red-500/10" : "border-white/15"
        } bg-[#121212]/95 backdrop-blur-2xl shadow-2xl overflow-hidden flex flex-col`}
      >
        {/* Ambient top highlight */}
        <div
          className={`absolute inset-x-0 top-0 h-px ${
            isOutdated
              ? "bg-gradient-to-r from-transparent via-red-500/50 to-transparent"
              : "bg-gradient-to-r from-transparent via-white/30 to-transparent"
          } pointer-events-none`}
        />

        <div className="p-5 sm:p-6 border-b border-white/10 bg-white/[0.02] flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${
                isOutdated
                  ? "bg-red-500/10 border-red-500/30 text-red-400 shadow-lg shadow-red-500/10"
                  : "bg-white/10 border-white/15 text-white"
              }`}
            >
              {isOutdated ? (
                <ShieldAlert className="w-5 h-5 text-red-400" />
              ) : (
                <Sparkles className="w-5 h-5 text-white" />
              )}
            </div>
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2
                  id="update-modal-title"
                  className="text-base sm:text-lg font-bold text-white tracking-tight m-0"
                >
                  {isOutdated ? t("Security Update Required") : t("Applio Update Available")}
                </h2>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    isOutdated
                      ? "bg-red-500/15 border-red-500/30 text-red-300 font-mono"
                      : "bg-white/10 border-white/15 text-neutral-200 font-mono"
                  }`}
                >
                  {displayVersion(versionData.latest)}
                </span>
              </div>
              <p className="text-xs text-neutral-400 m-0">
                {isOutdated
                  ? t("Running an outdated release. Updating automatically for security.")
                  : `${t("Current:")} ${displayVersion(versionData.local)} • ${t("Latest:")} ${displayVersion(versionData.latest)}`}
              </p>
            </div>
          </div>

          {/* Dismiss close button - always available and clickable */}
          <button
            type="button"
            onClick={handleClose}
            aria-label={t("Close")}
            className="w-8 h-8 p-0 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-4 text-xs sm:text-sm text-neutral-300">
          {/* Security Alert Banner when multiple versions behind */}
          {isOutdated && (
            <div className="p-3.5 rounded-xl border border-red-500/20 bg-red-500/[0.06] flex items-start gap-3 text-neutral-200">
              <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-xs text-red-300 m-0">
                  {t("Critical Version Notice")} ({versionsBehind} {t("updates behind")})
                </p>
                <p className="text-xs text-neutral-300 m-0 leading-relaxed">
                  {t(
                    "Your current version of Applio is significantly older than the latest release. To protect against known vulnerabilities, ensure dependency security, and maintain model inference integrity, this update is applied automatically.",
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Regular Update Notice */}
          {!isOutdated && (
            <p className="text-xs text-neutral-300 m-0 leading-relaxed">
              {t(
                "A new version of Applio is ready to install with performance enhancements, fixes, and updated features.",
              )}
            </p>
          )}

          {/* Progress / Status Display */}
          {(updating || updateStep !== "idle") && (
            <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-white flex items-center gap-2">
                  {updateStep === "downloading" && <Loader2 size={13} className="animate-spin text-white" />}
                  {updateStep === "ready" && <CheckCircle2 size={13} className="text-emerald-400" />}
                  {updateStep === "done" && <CheckCircle2 size={13} className="text-emerald-400" />}
                  {updateStep === "error" && <AlertTriangle size={13} className="text-red-400" />}
                  <span>{statusMessage || t("Processing update…")}</span>
                </span>
                {updateStep === "downloading" && updateProgress > 0 && (
                  <span className="font-mono text-neutral-400">{updateProgress}%</span>
                )}
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    updateStep === "ready" || updateStep === "done"
                      ? "bg-emerald-400"
                      : updateStep === "error"
                        ? "bg-red-500"
                        : "bg-white"
                  }`}
                  style={{
                    width:
                      updateStep === "ready" || updateStep === "done"
                        ? "100%"
                        : `${Math.max(updateProgress, 15)}%`,
                  }}
                />
              </div>

              {errorMsg && <p className="text-xs text-red-400 m-0 font-medium">{errorMsg}</p>}
            </div>
          )}

          {/* Release Notes Changelog Snippet */}
          {versionData.releaseNotes && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-200">
                  {t("What's New in")} {displayVersion(versionData.latest)}:
                </span>
                {versionData.htmlUrl && (
                  <a
                    href={versionData.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-neutral-400 hover:text-white flex items-center gap-1 transition-colors"
                  >
                    <span>{t("Full changelog")}</span>
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
              <div className="max-h-36 overflow-y-auto p-3 rounded-xl bg-black/40 border border-white/5 text-xs text-neutral-400 font-mono space-y-1 scrollbar-thin">
                {versionData.releaseNotes
                  .split("\n")
                  .filter((line) => line.trim().length > 0)
                  .slice(0, 10)
                  .map((line) => (
                    <p key={line} className="m-0 leading-tight">
                      {line.replace(/^-\s*/, "• ")}
                    </p>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-white/10 bg-black/40 backdrop-blur-md flex items-center justify-between gap-3">
          <div className="text-[11px] text-neutral-500 min-w-0 truncate">
            {isOutdated
              ? t("Automatic security update in progress…")
              : t("You can update now or choose later.")}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Later / Dismiss Button - always clickable to close */}
            {updateStep !== "ready" && updateStep !== "done" && (
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-xl text-xs font-medium text-neutral-300 hover:text-white hover:bg-white/10 transition-all cursor-pointer border border-transparent"
              >
                {updating ? t("Dismiss") : t("Update later")}
              </button>
            )}

            {/* Action CTA Button */}
            {updateStep === "ready" ? (
              <button
                type="button"
                onClick={handleRestartNow}
                className="cta flex items-center gap-2 py-2 px-5 text-xs font-semibold cursor-pointer"
              >
                <RefreshCw size={13} className="shrink-0" />
                <span>{t("Restart & Apply")}</span>
              </button>
            ) : updateStep === "done" ? (
              <button
                type="button"
                onClick={handleRestartNow}
                className="cta flex items-center gap-2 py-2 px-5 text-xs font-semibold cursor-pointer"
              >
                <RefreshCw size={13} className="shrink-0" />
                <span>{t("Reload App")}</span>
              </button>
            ) : updateStep === "downloading" ? (
              <button
                type="button"
                disabled
                className="cta flex items-center gap-2 py-2 px-5 text-xs font-semibold opacity-70 cursor-not-allowed"
              >
                <Loader2 size={13} className="animate-spin shrink-0" />
                <span>{isOutdated ? t("Updating…") : t("Downloading…")}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startUpdate()}
                disabled={updating}
                className="cta flex items-center gap-2 py-2 px-5 text-xs font-semibold cursor-pointer"
              >
                <ArrowDownCircle size={14} className="shrink-0" />
                <span>{t("Update now")}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
