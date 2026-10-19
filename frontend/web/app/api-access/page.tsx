"use client";

import {
  Activity,
  ArrowRight,
  BookOpen,
  Check,
  Code2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ApiReference from "@/components/ApiReference";
import Link from "@/components/layout/IntentLink";
import PageHeader from "@/components/layout/PageHeader";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CustomSelect,
  Disclosure,
  IconButton,
  SegmentedControl,
  StatTile,
} from "@/components/ui";
import { apiGet, apiSend, errMsg, type Job } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface ApiStatus {
  enabled: boolean;
  total: number;
  completed: number;
  active: number;
  failed: number;
  jobs: Job[];
  models: { id: string; name: string }[];
}

function CopyButton({ value, onError }: { value: string; onError: (message: string) => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      size="xs"
      variant="ghost"
      icon={copied ? <Check size={13} /> : <Copy size={13} />}
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => setCopied(true))
          .catch(() => onError(t("Could not copy. Select and copy the text manually.")));
      }}
    >
      {t("Copy")}
    </Button>
  );
}

function CodeSample({ code, label }: { code: string; label?: string }) {
  const { t } = useI18n();
  const [error, setError] = useState("");
  return (
    <div className="api-code-sample">
      <div className="api-code-toolbar">
        <span className="inline-flex items-center gap-2 text-xs text-[var(--muted)]">
          <Terminal size={13} aria-hidden="true" /> {label || t("Examples")}
        </span>
        <CopyButton value={code} onError={setError} />
      </div>
      <pre className="api-code">
        <code>{code}</code>
      </pre>
      {error && (
        <p role="alert" className="field-help p-3 m-0">
          {error}
        </p>
      )}
    </div>
  );
}

export default function ApiAccessPage() {
  const { t } = useI18n();
  const [view, setView] = useState("api-start");
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [base, setBase] = useState("http://127.0.0.1:3000");
  const [model, setModel] = useState("");
  const [example, setExample] = useState("python");
  const [probe, setProbe] = useState("");
  useEffect(() => {
    if (keyCopied) {
      const timer = setTimeout(() => setKeyCopied(false), 1800);
      return () => clearTimeout(timer);
    }
  }, [keyCopied]);
  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<ApiStatus>("/api/integrations", { force: true });
      setStatus(data);
      setModel((current) =>
        data.models.some((model) => model.id === current) ? current : data.models[0]?.id || "",
      );
      setError("");
    } catch (error) {
      setError(errMsg(error));
    }
  }, []);
  useEffect(() => {
    setBase(window.location.origin);
    void refresh();
    const interval = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function changeKey(revoke = false) {
    setBusy(true);
    setError("");
    try {
      const result = await apiSend<{ key?: string }>("/api/integrations/key", revoke ? "DELETE" : "POST");
      setKey(result.key || "");
      setShowKey(false);
      setProbe("");
      await refresh();
    } catch (error) {
      setError(errMsg(error));
    } finally {
      setBusy(false);
    }
  }
  async function testConnection() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${base}/v1/models`, {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || response.statusText);
      setProbe(JSON.stringify(result, null, 2));
    } catch (error) {
      setError(errMsg(error));
    } finally {
      setBusy(false);
    }
  }
  const selected = model || "applio-your-model-id";
  const snippets: Record<string, string> = {
    python: `# pip install openai\nimport os\nfrom openai import OpenAI\n\nclient = OpenAI(\n    base_url="${base}/v1",\n    api_key=os.environ["APPLIO_API_KEY"],\n    timeout=600.0,\n)\n\nwith client.audio.speech.with_streaming_response.create(\n    model="${selected}",\n    voice="en-US-AriaNeural",\n    input="Hello from Applio.",\n    response_format="wav",\n) as response:\n    response.stream_to_file("speech.wav")`,
    curl: `curl "${base}/v1/models" \\\n  -H "Authorization: Bearer $APPLIO_API_KEY"\n\ncurl "${base}/v1/audio/speech" \\\n  -H "Authorization: Bearer $APPLIO_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${selected}","voice":"en-US-AriaNeural","input":"Hello from Applio.","response_format":"wav"}' \\\n  --output speech.wav`,
    workflow: `# 1. Submit a conversion (returns HTTP 202 and jobId)\ncurl "${base}/v1/audio/conversions" \\\n  -H "Authorization: Bearer $APPLIO_API_KEY" \\\n  -F "audio=@input.wav" \\\n  -F "model=${selected}" \\\n  -F "pitch=0" -F "exportFormat=WAV"\n\n# 2. Poll until job.status is done (or error)\ncurl "${base}/v1/jobs/$JOB_ID" \\\n  -H "Authorization: Bearer $APPLIO_API_KEY"\n\n# 3. Download the completed audio\ncurl "${base}/v1/jobs/$JOB_ID/content" \\\n  -H "Authorization: Bearer $APPLIO_API_KEY" \\\n  --output converted.wav\n\n# Cancel queued or running work\ncurl -X POST "${base}/v1/jobs/$JOB_ID/cancel" \\\n  -H "Authorization: Bearer $APPLIO_API_KEY"`,
  };
  const endpoints = [
    ["GET", "/v1/models", "Models"],
    ["POST", "/v1/audio/speech", "Text to Speech"],
    ["POST", "/v1/audio/conversions", "Convert Audio"],
    ["GET", "/v1/jobs/{id}", "Job history"],
    ["GET", "/v1/jobs/{id}/content", "Download"],
    ["POST", "/v1/jobs/{id}/cancel", "Stop"],
    ["GET", "/v1/jobs/{id}/artifacts", "Download"],
    ["GET", "/v1/jobs/{id}/artifacts/{index}", "Download"],
    ["GET", "/v1/applio/tts/voices", "Text to Speech"],
  ];
  return (
    <div className="w-full max-w-[1920px] mx-auto page-stack">
      <PageHeader
        title={t("API & Workflows")}
        description={t("Connect apps and automate audio workflows")}
        guide={false}
      >
        <Button
          onClick={() => setView("api-docs")}
          icon={<BookOpen size={14} />}
          variant="ghost"
          size="sm"
          className="page-header-action"
        >
          {t("Documentation")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="page-header-action"
          icon={<RefreshCw size={14} />}
          onClick={() => void refresh()}
        >
          {t("Refresh")}
        </Button>
      </PageHeader>
      {error && (
        <Alert variant="error" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}
      <Card className="api-hero">
        <div className="api-hero-copy">
          <span className="api-eyebrow">
            <Code2 size={15} /> APPLIO / API
          </span>
          <h2 className="text-2xl sm:text-3xl font-semibold m-0">
            {t("Your voice engine. Your workflows.")}
          </h2>
          <p className="text-sm text-[var(--muted)] max-w-xl m-0 leading-relaxed">
            {t("Use the OpenAI SDK for speech and the job API for longer workflows.")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant={status?.enabled ? "success" : "neutral"} dot>
              {t(status ? (status.enabled ? "Ready" : "Disabled") : "Loading…")}
            </Badge>
            <Badge>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={12} /> {t("Local access only")}
              </span>
            </Badge>
          </div>
        </div>
        <div className="api-address">
          <div className="flex justify-between items-center gap-3">
            <span className="field-label m-0">{t("Base URL")}</span>
            <CopyButton value={`${base}/v1`} onError={setError} />
          </div>
          <code>{base}/v1</code>
          <span className="field-help">
            {t("Keep Applio running. API keys and Bridge access are separate.")}
          </span>
        </div>
      </Card>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatTile label={t("API jobs")} value={status?.total ?? "—"} icon={<Terminal size={15} />} />
        <StatTile label={t("Completed")} value={status?.completed ?? "—"} icon={<Check size={15} />} />
        <StatTile label={t("Active jobs")} value={status?.active ?? "—"} icon={<Activity size={15} />} />
        <StatTile label={t("Models")} value={status?.models.length ?? "—"} icon={<Code2 size={15} />} />
      </div>
      <SegmentedControl
        value={view}
        onChange={setView}
        ariaLabel={t("API & Workflows")}
        tabPanels
        options={[
          { value: "api-start", label: t("Quick start"), icon: Code2 },
          { value: "api-docs", label: t("API reference"), icon: BookOpen },
          { value: "api-activity", label: t("Recent API jobs"), icon: Activity },
        ]}
      />
      <div id="panel-api-start" role="tabpanel" aria-labelledby="tab-api-start" hidden={view !== "api-start"}>
        <div className="api-setup-grid">
          <div className="space-y-4 min-w-0">
            <Card className="space-y-4">
              <CardHeader
                step={1}
                title={t("API key")}
                description={t(
                  "Create a key, copy it into your app, and keep it private. Rotating or revoking it stops future requests.",
                )}
              />
              <div className="flex gap-2 items-center">
                <input
                  className="min-w-0 flex-1 font-mono"
                  aria-label={t("API key")}
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  onChange={(event) => {
                    setKey(event.target.value);
                    setProbe("");
                  }}
                  placeholder="applio_…"
                />
                <IconButton
                  label={t(showKey ? "Hide API key" : "Show API key")}
                  icon={showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  onClick={() => setShowKey(!showKey)}
                />
                <IconButton
                  label={t("Copy")}
                  disabled={!key}
                  icon={keyCopied ? <Check size={15} /> : <Copy size={15} />}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(key)
                      .then(() => setKeyCopied(true))
                      .catch(() => setError(t("Could not copy. Select and copy the text manually.")));
                  }}
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  loading={busy}
                  disabled={!status}
                  onClick={() => void changeKey()}
                  icon={<KeyRound size={14} />}
                >
                  {t(status?.enabled ? "Rotate API key" : "Create API key")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!key || busy}
                  onClick={() => void testConnection()}
                >
                  {t("Test connection")}
                </Button>
                {status?.enabled && (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    icon={<Trash2 size={14} />}
                    onClick={() => void changeKey(true)}
                  >
                    {t("Revoke API key")}
                  </Button>
                )}
              </div>
              {probe && (
                <div className="space-y-3" role="status">
                  <Badge variant="success" dot>
                    {t("Ready")}
                  </Badge>
                  <Disclosure title={t("Response")}>
                    <CodeSample code={probe} label="JSON" />
                  </Disclosure>
                </div>
              )}
              <p className="field-help m-0">
                {t("The key is only returned when created. Save it before leaving this page.")}
              </p>
            </Card>
            <Disclosure title={t("Endpoints")} icon={<Terminal size={16} />}>
              <div className="api-endpoints">
                {endpoints.map(([method, path, label]) => (
                  <div key={path}>
                    <span className={`api-method ${method === "POST" ? "api-method-post" : ""}`}>
                      {method}
                    </span>
                    <div>
                      <code>{path}</code>
                      <span>{t(label)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="field-help">
                {t("Every /v1 request needs Authorization: Bearer followed by your API key.")}
              </p>
            </Disclosure>
          </div>
          <div className="space-y-4 min-w-0">
            <Card className="space-y-4">
              <CardHeader step={2} title={t("Quick start")} />
              <label className="field-label" htmlFor="api-example-model">
                {t("Voice Model")}
              </label>
              <CustomSelect
                id="api-example-model"
                aria-label={t("Voice Model")}
                value={model}
                onValueChange={setModel}
                placeholder={t("Select a voice model…")}
                options={
                  status?.models.map((model) => ({
                    value: model.id,
                    label: model.name,
                    description: model.id,
                  })) || []
                }
              />
              {status && !status.models.length && (
                <p className="field-help">
                  {t(
                    "Install a voice model to generate speech. Model listing and authentication work without one.",
                  )}
                </p>
              )}
              <SegmentedControl
                value={example}
                onChange={setExample}
                ariaLabel={t("Examples")}
                options={[
                  { value: "python", label: "Python SDK" },
                  { value: "curl", label: "cURL" },
                  { value: "workflow", label: t("Workflow") },
                ]}
              />
              <CodeSample
                code={snippets[example]}
                label={example === "python" ? "Python SDK" : example === "curl" ? "cURL" : t("Workflow")}
              />
              {example !== "workflow" && (
                <p className="field-help">
                  {t(
                    "Speech uses Edge TTS and an installed RVC model. Formats: MP3, WAV, FLAC. Speed: 0.25–2.0.",
                  )}
                </p>
              )}
              <p className="field-help">
                {t(
                  "Speech returns audio after processing. Conversion returns HTTP 202: poll the job until done, then download its content. Failed or cancelled jobs must not be treated as successful audio.",
                )}
              </p>
              <Disclosure title={t("Documentation")} icon={<BookOpen size={16} />}>
                <CodeSample
                  label="cURL"
                  code={`curl "${base}/v1/openapi.json" \\\n  -H "Authorization: Bearer $APPLIO_API_KEY"\n\ncurl -H "Authorization: Bearer $APPLIO_API_KEY" "${base}/v1/applio/tts/voices"`}
                />
                <p className="field-help">
                  {t(
                    "Use voice shortName values from the voice catalog. Conversion uses the same parameters as the Convert Audio tab.",
                  )}
                </p>
              </Disclosure>
            </Card>
          </div>
        </div>
      </div>
      <div id="panel-api-docs" role="tabpanel" aria-labelledby="tab-api-docs" hidden={view !== "api-docs"}>
        <ApiReference base={base} />
      </div>
      <div
        id="panel-api-activity"
        role="tabpanel"
        aria-labelledby="tab-api-activity"
        hidden={view !== "api-activity"}
      >
        <Card className="space-y-3">
          <CardHeader
            icon={<Activity size={18} />}
            title={t("Recent API jobs")}
            action={
              <Link href="/jobs" className="flex gap-1 items-center text-xs">
                {t("Job history")}
                <ArrowRight size={13} />
              </Link>
            }
          />
          <p className="field-help">
            {t(
              "Metrics cover retained API jobs, not lifetime usage. Speech jobs appear after validation and admission.",
            )}
          </p>
          {status?.jobs.length ? (
            status.jobs.map((job) => (
              <Link
                key={job.id}
                href={`/jobs/view?id=${encodeURIComponent(job.id)}`}
                className="flex flex-wrap justify-between items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2"
              >
                <span className="font-mono text-xs">{job.id}</span>
                <Badge
                  variant={job.status === "done" ? "success" : job.status === "error" ? "danger" : "neutral"}
                >
                  {t({ done: "Completed", error: "Error", queued: "Queued", running: "Running" }[job.status])}
                </Badge>
              </Link>
            ))
          ) : (
            <div className="api-jobs-empty">
              <Activity size={26} aria-hidden="true" />
              <p className="text-sm m-0">{t(status ? "No API jobs yet" : "Loading…")}</p>
              <Button size="sm" variant="ghost" onClick={() => setView("api-start")}>
                {t("Quick start")}
                <ArrowRight size={14} />
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
