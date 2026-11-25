"use client";

import { BookOpen, ExternalLink, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Button } from "@/components/ui";
import ProgressBar from "@/components/ui/ProgressBar";
import { apiGet, apiSend, errMsg } from "@/lib/api";
import { guideForPage } from "@/lib/ecosystem";
import { useI18n } from "@/lib/i18n";

interface TensorboardStatus {
  running: boolean;
  starting: boolean;
  url: string;
}

function resolveFrameUrl(rawUrl: string): string {
  // Browser sessions use the API hostname with the configured TensorBoard port.
  const port = new URL(rawUrl).port;
  const frameUrl = new URL(window.location.origin);
  frameUrl.protocol = "http:";
  frameUrl.port = port;
  return frameUrl.href;
}

export default function TensorboardPage() {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const documentationHref = guideForPage("/tensorboard");

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry restarts the connection effect.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function openTensorboard() {
      try {
        const status = await apiGet<TensorboardStatus>("/api/tensorboard/status", { ttlMs: 0, signal });
        if (signal.aborted) return;
        if (status.starting && !status.running) {
          timer = setTimeout(openTensorboard, 500);
          return;
        }
        const result = status.running
          ? status
          : await apiSend<{ url: string }>("/api/tensorboard/start", "POST");
        if (signal.aborted) return;
        setUrl(resolveFrameUrl(result.url));
      } catch (cause) {
        if (!signal.aborted) setError(errMsg(cause));
      }
    }

    void openTensorboard();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [attempt]);

  function handleReload() {
    setLoaded(false);
    setIframeKey((current) => current + 1);
  }

  async function handleRestart() {
    setRestarting(true);
    setError("");
    setLoaded(false);
    try {
      const result = await apiSend<{ url: string }>("/api/tensorboard/restart", "POST");
      setUrl(resolveFrameUrl(result.url));
      setIframeKey((current) => current + 1);
    } catch (cause) {
      setError(errMsg(cause));
    } finally {
      setRestarting(false);
    }
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden border-y border-[var(--border)] bg-[var(--surface)] lg:rounded-xl lg:border">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-3 py-2 sm:px-4 shrink-0">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="title m-0 shrink-0 text-base sm:text-lg leading-tight text-[var(--heading)]">
            {t("TensorBoard")}
          </h1>
          <p className="m-0 hidden xl:block truncate text-xs text-[var(--muted)]">
            {t("Monitor loss curves, spectrograms, and training metrics live during model training.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {url && (
            <>
              <Button
                variant="ghost"
                onClick={handleReload}
                title={t("Reload TensorBoard view")}
                aria-label={t("Reload TensorBoard view")}
                className="app-button-compact"
                icon={<RefreshCw className="w-3.5 h-3.5" />}
              >
                <span className="hidden sm:inline">{t("Reload")}</span>
              </Button>
              <Button
                href={url}
                target="_blank"
                variant="ghost"
                title={t("Open in browser tab")}
                aria-label={t("Open in browser tab")}
                className="app-button-compact"
                icon={<ExternalLink className="w-3.5 h-3.5" />}
              >
                <span className="hidden sm:inline">{t("Open Tab")}</span>
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            onClick={() => void handleRestart()}
            disabled={restarting}
            title={t("Restart TensorBoard backend service")}
            aria-label={t("Restart TensorBoard backend service")}
            className="app-button-compact"
            icon={<RotateCcw className={`w-3.5 h-3.5 ${restarting ? "animate-spin" : ""}`} />}
          >
            <span className="hidden sm:inline">{restarting ? t("Restarting…") : t("Restart")}</span>
          </Button>
          {documentationHref && (
            <Button
              href={documentationHref}
              target="_blank"
              variant="ghost"
              title={t("User guide")}
              aria-label={t("User guide")}
              className="app-button-compact"
              icon={<BookOpen className="w-3.5 h-3.5" />}
            >
              <span className="hidden sm:inline">{t("User guide")}</span>
            </Button>
          )}
        </div>
      </header>
      <section
        aria-label={t("TensorBoard")}
        className="relative flex-1 min-h-80 overflow-hidden bg-[var(--surface)]"
      >
        {url && (
          <iframe
            key={iframeKey}
            src={url}
            title={t("TensorBoard")}
            onLoad={() => setLoaded(true)}
            className="absolute inset-0 h-full w-full border-0"
          />
        )}
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4">
            <Alert variant="error">{error}</Alert>
            <Button
              onClick={() => {
                setError("");
                setLoaded(false);
                setAttempt((current) => current + 1);
              }}
            >
              {t("Retry")}
            </Button>
          </div>
        ) : (
          !loaded && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--surface)] p-4"
              role="status"
            >
              <p className="m-0">{restarting ? t("Restarting TensorBoard…") : t("Starting TensorBoard…")}</p>
              <div className="w-full max-w-56">
                <ProgressBar label={restarting ? t("Restarting TensorBoard…") : t("Starting TensorBoard…")} />
              </div>
            </div>
          )
        )}
      </section>
    </div>
  );
}
