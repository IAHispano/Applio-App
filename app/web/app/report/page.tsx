"use client";

import { Bug, Copy, Cpu, Download, ExternalLink, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Alert, Button, Card, CardHeader, StatTile } from "@/components/ui";
import { apiGet, apiSend, errMsg, outputUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { toast } from "@/lib/toast";

interface SystemInfo {
  version: string;
  platform: string;
  node: string;
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
          setMsg(`Clip saved → ${r.file}. Attach it to your GitHub issue.`);
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

  const issueBody = info
    ? `**Describe the bug**%0A%0A**System**%0A- Applio ${info.version} · ${info.platform}%0A- Node ${info.node} · ${info.python}%0A- CPUs ${info.cpus} · RAM ${info.totalMemGB}GB`
    : "";

  return (
    <div className="w-full max-w-[1920px] mx-auto space-y-6">
      <PageHeader
        title={t("Report a Bug")}
        description={t("Collect system diagnostics, record screen logs, and submit issue reports to GitHub.")}
      />

      {msg && (
        <Alert variant="info" onDismiss={() => setMsg("")}>
          {msg}
        </Alert>
      )}

      {/* Guide Card */}
      <Card>
        <CardHeader
          icon={<Bug size={18} />}
          title={t("How to Report an Issue on GitHub")}
          description={t(
            "Follow these steps to record a reproduction clip and submit a detailed bug report.",
          )}
        />
        <ol className="space-y-2 text-xs text-neutral-300 m-0 pl-4 leading-relaxed">
          <li>{t("Click on 'Record Screen' to start recording the issue you are experiencing.")}</li>
          <li>{t("Once you have finished reproducing the issue, click 'Stop Recording'.")}</li>
          <li>{t("Go to GitHub Issues and click on 'New Issue'.")}</li>
          <li>
            {t(
              "Complete the provided issue template, paste the diagnostic information below, and attach the recorded screen clip.",
            )}
          </li>
        </ol>

        <div className="flex items-center gap-3 pt-3.5 border-t border-white/5 flex-wrap">
          <Button
            variant={recording ? "ghost" : "primary"}
            onClick={toggleRecord}
            icon={<Video size={16} className={recording ? "animate-pulse" : undefined} />}
          >
            {recording ? t("Stop Recording") : t("Record Screen")}
          </Button>
          {info && (
            <Button
              href={`${info.issueUrl}?body=${issueBody}`}
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
                  const text = `Applio ${info.version}\n${info.platform}\nNode ${info.node}\n${info.python}\nCPUs: ${info.cpus} · RAM: ${info.totalMemGB}GB`;
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
            <StatTile label={t("Applio Version")} value={info.version} />
            <StatTile label={t("Platform")} value={info.platform} />
            <StatTile label={t("Engine Runtimes")} value={`Node ${info.node}`} subtext={info.python} />
            <StatTile
              label={t("Compute Resources")}
              value={`${info.cpus} CPU cores`}
              subtext={`${info.totalMemGB} GB RAM`}
            />
          </div>
        ) : (
          <p className="text-xs text-neutral-400 m-0">{t("Collecting system info…")}</p>
        )}
      </Card>
    </div>
  );
}
