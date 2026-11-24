"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Alert, Button } from "@/components/ui";
import ProgressBar from "@/components/ui/ProgressBar";
import { apiGet, apiSend, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface TensorboardStatus {
  running: boolean;
  starting: boolean;
  url: string;
}

export default function TensorboardPage() {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

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

        // Browser sessions use the API hostname with the configured TensorBoard port.
        const port = new URL(result.url).port;
        const frameUrl = new URL(window.location.origin);
        frameUrl.protocol = "http:";
        frameUrl.port = port;
        setUrl(frameUrl.href);
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

  return (
    <>
      <PageHeader
        title={t("TensorBoard")}
        description={t("Monitor loss curves, spectrograms, and training metrics live during model training.")}
        className="mb-3 shrink-0"
      />
      <section
        aria-label={t("TensorBoard")}
        className="relative flex-1 min-h-80 -mx-[var(--workspace-gutter)] overflow-hidden border-y border-[var(--border)] bg-[var(--surface)]"
      >
        {url && (
          <iframe
            src={url}
            title={t("TensorBoard")}
            onLoad={() => setLoaded(true)}
            className="absolute inset-0 w-full h-full border-0"
          />
        )}
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4">
            <Alert variant="error">{error}</Alert>
            <Button
              onClick={() => {
                setError("");
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
              <p className="m-0">{t("Starting TensorBoard…")}</p>
              <div className="w-full max-w-56">
                <ProgressBar label={t("Starting TensorBoard…")} />
              </div>
            </div>
          )
        )}
      </section>
    </>
  );
}
