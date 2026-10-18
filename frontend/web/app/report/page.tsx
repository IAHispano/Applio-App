"use client";

import { Bug, Copy, Cpu, Download, ExternalLink, MessageCircle, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Alert, Button, Card, CardHeader, StatTile } from "@/components/ui";
import { apiGet, apiSend, errMsg, outputUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { diagnosticRuntime, formatDiagnostics, issueReportUrl } from "@/lib/report";
import { DISCORD_SUPPORT_URL } from "@/lib/support";
import { toast } from "@/lib/toast";

interface SystemInfo {
  version: string;
  backendRevision?: string;
  platform: string;
  node?: string;
  runtime?: string;
  python: string;
  cpus: number;
  totalMemGB: number;
  issueUrl: string;
}

export default function ReportPage() {
  const { t } = useI18n();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [recording, setRecording] = useState(false);
  const [clip, setClip] = useState("");
  const [msg, setMsg] = useState("");
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    apiGet<SystemInfo>("/api/report/info")
      .then(setInfo)
      .catch((e) => setMsg(errMsg(e)));
  }, []);

  async function toggleRecord() {
    setMsg("");
    if (recording) {
      recRef.current?.stop();
      return;
    }
    try {
      // Capture the screen in-browser.
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const rec = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : undefined,
      });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => {
          t.stop();
        });
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        const dataUrl = await new Promise<string>((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.readAsDataURL(blob);
        });
        try {
          const r = await apiSend<{ file: string; issueUrl: string }>("/api/report/upload", "POST", {
            dataUrl,
          });
          setClip(r.file);
          setMsg(t("Clip saved: {file}. Attach it to your GitHub issue.", { file: r.file }));
        } catch (e) {
          setMsg(errMsg(e));
        }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setMsg(t("Screen capture cancelled or unsupported in this browser."));
    }
  }

  return (
    <div className="w-full max-w-[1920px] mx-auto page-stack">
      <PageHeader
        title={t("Report a Bug")}
        description={t("Collect system diagnostics, record screen logs, and submit issue reports to GitHub.")}
      />

      {msg && (
        <Alert variant="info" onDismiss={() => setMsg("")}>
          {msg}
        </Alert>
      )}

      <Card>
        <CardHeader
          icon={<MessageCircle size={18} />}
          title={t("Get help on Discord")}
          description={t(
            "Join our Discord and share your issue in {channel}, our dedicated Applio App testing channel.",
            { channel: "#applio-app-testers" },
          )}
        />
        <Button href={DISCORD_SUPPORT_URL} target="_blank" icon={<ExternalLink size={16} />}>
          {t("Join our Discord")}
        </Button>
      </Card>

      {/* Guide Card */}
      <Card>
        <CardHeader
          icon={<Bug size={18} />}
          title={t("How to Report an Issue on GitHub")}
          description={t(
            "Help us reproduce your issue: include clear steps, relevant settings, and a screenshot or short video.",
          )}
        />
        <ol className="space-y-2 text-xs text-neutral-300 m-0 pl-4 leading-relaxed">
          <li>
            {t(
              "Record the problem with 'Record Screen', or take a screenshot showing the affected page and any error.",
            )}
          </li>
          <li>
            {t(
              "Write the exact steps and settings, what you expected, what happened instead, and how often it happens.",
            )}
          </li>
          <li>
            {t(
              "Click 'Open GitHub Issue' to open the guided bug form with your system diagnostics already filled in. Complete every required field.",
            )}
          </li>
          <li>
            {t(
              "Attach a screenshot or video directly to the GitHub report. Download recorded clips below first; they are not attached automatically.",
            )}
          </li>
        </ol>

        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant={recording ? "ghost" : "primary"}
            onClick={toggleRecord}
            icon={<Video size={16} className={recording ? "animate-pulse" : undefined} />}
          >
            {recording ? t("Stop Recording") : t("Record Screen")}
          </Button>
          {info && (
            <Button
              href={issueReportUrl(info)}
              target="_blank"
              variant="ghost"
              icon={<ExternalLink size={16} className="text-white" />}
            >
              {t("Open GitHub Issue")}
            </Button>
          )}
        </div>
      </Card>

      {clip && (
        <Card>
          {/* biome-ignore lint/a11y/useMediaCaption: user-recorded screen capture has no caption track */}
          <video controls src={outputUrl(clip)} className="max-w-full rounded-xl border border-white/10" />
          <div className="flex items-center justify-between">
            <Button href={outputUrl(clip)} download icon={<Download size={16} />}>
              {t("Download Video")}
            </Button>
            <span className="text-xs text-neutral-400">{clip}</span>
          </div>
        </Card>
      )}

      {/* Diagnostics Card */}
      <Card>
        <CardHeader
          icon={<Cpu size={18} />}
          title={t("System Diagnostics")}
          description={t("Environment details and system specifications to include in your issue report.")}
          action={
            info && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const text = formatDiagnostics(info);
                  navigator.clipboard.writeText(text);
                  toast(t("Diagnostics copied to clipboard"));
                }}
                icon={<Copy size={13} />}
              >
                {t("Copy Diagnostics")}
              </Button>
            )
          }
        />

        {info ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              label={t("Applio Version")}
              value={info.version}
              subtext={`${t("Engine revision")}: ${info.backendRevision?.slice(0, 12) || "unknown"}`}
            />
            <StatTile label={t("Platform")} value={info.platform} />
            <StatTile label={t("Engine Runtimes")} value={diagnosticRuntime(info)} subtext={info.python} />
            <StatTile
              label={t("Compute Resources")}
              value={t("{count} CPU cores", { count: info.cpus })}
              subtext={t("{count} GB RAM", { count: info.totalMemGB })}
            />
          </div>
        ) : (
          <p className="text-xs text-neutral-400 m-0">{t("Collecting system info…")}</p>
        )}
      </Card>
    </div>
  );
}
