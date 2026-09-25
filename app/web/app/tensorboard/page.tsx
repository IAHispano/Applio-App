"use client";

import { ExternalLink, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Alert, Button } from "@/components/ui";
import { apiGet, apiSend, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function TensorboardPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<{
    running: boolean;
    starting?: boolean;
    url: string;
    startedAt: string | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [restarting, setRestarting] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const autoStartedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      // Status polls must bypass the apiGet cache or engine state freezes.
      const res = await apiGet<{
        running: boolean;
        starting?: boolean;
        url: string;
        startedAt: string | null;
      }>("/api/tensorboard/status", { ttlMs: 0 });
      setStatus(res);
      setError("");

      // Attempt background auto-start once if service is not running and not starting when tab opens
      if (!res.running && !res.starting && !autoStartedRef.current) {
        autoStartedRef.current = true;
        apiSend("/api/tensorboard/start", "POST")
          .then(() => {
            void apiGet<{
              running: boolean;
              starting?: boolean;
              url: string;
              startedAt: string | null;
            }>("/api/tensorboard/status", { ttlMs: 0 }).then(setStatus);
          })
          .catch((err) => setError(errMsg(err)));
      }
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    if (restarting) return;
    refresh();
    // Poll every 5s if running, every 2s if starting
    const interval = status?.running ? 5000 : 2000;
    const t = setInterval(refresh, interval);
    return () => clearInterval(t);
  }, [refresh, status?.running, restarting]);

  async function handleRestart() {
    setRestarting(true);
    setError("");
    try {
      await apiSend("/api/tensorboard/restart", "POST");
      await refresh();
      setIframeKey((k) => k + 1);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRestarting(false);
    }
  }

  function handleReloadIframe() {
    setIframeKey((k) => k + 1);
  }

  // The iframe points at the API host directly; on Colab/Kaggle expose TB_PORT like :3000.
  const tbHost = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
  const tbPort = status?.url?.match(/:(\d+)$/)?.[1] || "6007";
  const iframeUrl = `http://${tbHost}:${tbPort}/`;

  const isRunning = status?.running ?? false;
  const isStarting = restarting || (status?.starting ?? false);

  return (
    <div className="w-full max-w-[2400px] mx-auto flex-1 h-full flex flex-col min-h-0 space-y-3 pb-1">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
        <PageHeader
          title={t("TensorBoard")}
          description={t(
            "Monitor loss curves, spectrograms, and training metrics live during model training.",
          )}
        />
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {isRunning && (
            <>
              <Button
                variant="ghost"
                size="xs"
                onClick={handleReloadIframe}
                title={t("Reload TensorBoard view")}
                icon={<RefreshCw className="w-3.5 h-3.5" />}
              >
                <span className="hidden md:inline">{t("Reload")}</span>
              </Button>
              <Button
                href={iframeUrl}
                target="_blank"
                variant="ghost"
                size="xs"
                title={t("Open in browser tab")}
                icon={<ExternalLink className="w-3.5 h-3.5" />}
              >
                <span className="hidden md:inline">{t("Open Tab")}</span>
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="xs"
            onClick={handleRestart}
            disabled={restarting}
            title={t("Restart TensorBoard backend service")}
            icon={<RotateCcw className={`w-3.5 h-3.5 ${restarting ? "animate-spin" : ""}`} />}
          >
            <span className="hidden md:inline">{restarting ? t("Restarting…") : t("Restart")}</span>
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="error" onDismiss={() => setError("")} className="shrink-0">
          {error}
        </Alert>
      )}

      <div className="flex-1 min-h-[400px] w-full relative rounded-xl border border-white/10 overflow-hidden bg-black/40">
        {isRunning ? (
          <iframe
            key={iframeKey}
            ref={iframeRef}
            src={iframeUrl}
            title={t("TensorBoard")}
            className="w-full h-full border-0 absolute inset-0"
          />
        ) : isStarting ? (
          <div
            className="w-full h-full flex flex-col items-center justify-center gap-4 text-neutral-400 p-8"
            role="status"
            aria-live="polite"
          >
            <div
              className="w-56 h-1.5 rounded-full bg-white/10 overflow-hidden relative"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={restarting ? t("Restarting TensorBoard…") : t("Starting TensorBoard…")}
            >
              <div className="h-full bg-white rounded-full animate-pulse w-3/4" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-neutral-200">
                {restarting ? t("Restarting TensorBoard…") : t("Starting TensorBoard…")}
              </p>
              <p className="text-xs text-neutral-500">
                {t("The service is initializing in the backend and will display automatically.")}
              </p>
            </div>
          </div>
        ) : (
          <div
            className="w-full h-full flex flex-col items-center justify-center gap-4 text-neutral-400 p-8"
            role="status"
          >
            <RotateCcw className="w-8 h-8 text-neutral-500" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-neutral-200">{t("TensorBoard is not running")}</p>
              <p className="text-xs text-neutral-500 max-w-sm">
                {t("Start or restart the service to monitor training loss, metrics, and audio spectrograms.")}
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleRestart}
              icon={<RotateCcw className="w-3.5 h-3.5" />}
            >
              {t("Start TensorBoard")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
