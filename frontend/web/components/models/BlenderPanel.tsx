"use client";
import { Layers, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import JobPanel from "@/components/JobPanel";
import { Alert, Badge, Button, Card, CardHeader, FileInput } from "@/components/ui";
import ModelDropdown from "@/components/ui/ModelDropdown";
import SettingHelp from "@/components/ui/SettingHelp";
import SliderField from "@/components/ui/SliderField";
import { errMsg, fetchModels, fileBasename, postForm } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";
import { usePersistentJobId } from "@/lib/useJob";
import { useWorkspaceState } from "@/lib/workspace-state";
export default function BlenderPanel() {
  const { t } = useI18n();
  const [models, setModels] = useWorkspaceState<string[]>("BlenderPanel:models:models", []);
  const [name, setName] = useWorkspaceState("BlenderPanel:models:name", "");
  const [p1, setP1] = useWorkspaceState("BlenderPanel:models:p1", "");
  const [p2, setP2] = useWorkspaceState("BlenderPanel:models:p2", "");
  const [f1, setF1] = useWorkspaceState<File | null>("BlenderPanel:models:f1", null);
  const [f2, setF2] = useWorkspaceState<File | null>("BlenderPanel:models:f2", null);
  const [ratio, setRatio] = useWorkspaceState("BlenderPanel:models:ratio", 0.5);
  const [jobId, setJobId] = usePersistentJobId("blender");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetchModels()
      .then((m) => {
        const checkpoints = m.models.filter((model) => model.toLowerCase().endsWith(".pth"));
        setModels(checkpoints);
        if (checkpoints[0]) setP1((current) => current || checkpoints[0]);
        if (checkpoints[1]) setP2((current) => current || checkpoints[1]);
      })
      .catch(() => {});
  }, [setP2, setP1, setModels]);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name || (!p1 && !f1) || (!p2 && !f2)) {
      setError(t("Name and two models are required (path or upload)."));
      return;
    }
    if ([f1?.name || p1, f2?.name || p2].some((model) => !model.toLowerCase().endsWith(".pth"))) {
      setError(t("Blending requires .pth voice models; ONNX files are not supported."));
      return;
    }
    const picked = [f1?.name || p1, f2?.name || p2].map((s) => s.split(/[\\/]/).pop() || "");
    if (picked.some((n) => n.startsWith("G_") || n.startsWith("D_"))) {
      setError(
        t("Training checkpoints (G_*.pth / D_*.pth) can't be blended. Use exported inference .pth files."),
      );
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("modelName", name);
      fd.append("pthPath1", p1);
      fd.append("pthPath2", p2);
      if (f1) fd.append("pth_file_1", f1);
      if (f2) fd.append("pth_file_2", f2);
      fd.append("ratio", String(ratio));
      const { jobId: id } = await postForm<{ jobId: string }>("/api/voice-blender", fd);
      setJobId(id);
    } catch (err) {
      setError(errMsg(err) || t("Submit failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="page-stack">
      {error && (
        <Alert variant="error" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 card-grid">
        {[
          { number: 1, path: p1, file: f1, setPath: setP1, setFile: setF1 },
          { number: 2, path: p2, file: f2, setPath: setP2, setFile: setF2 },
        ].map((source) => (
          <Card key={source.number} className="space-y-4">
            <CardHeader
              icon={<Layers size={18} />}
              title={t(source.number === 1 ? "Model 1" : "Model 2")}
              description={t(SETTING_HELP.blendModel)}
              action={
                <Badge variant="neutral">
                  {source.number === 1 ? Math.round(ratio * 100) : 100 - Math.round(ratio * 100)}%
                </Badge>
              }
            />
            <label className="sr-only" htmlFor={`blend-model-${source.number}`}>
              {t(source.number === 1 ? "Model 1" : "Model 2")}
            </label>
            <ModelDropdown
              id={`blend-model-${source.number}`}
              models={models}
              selectedModel={source.file ? "" : source.path}
              onSelect={(path) => {
                source.setPath(path);
                source.setFile(null);
              }}
              onUnload={() => source.setPath("")}
              onRefresh={() => {
                void fetchModels(true)
                  .then((data) =>
                    setModels(data.models.filter((model) => model.toLowerCase().endsWith(".pth"))),
                  )
                  .catch((err) => setError(errMsg(err)));
              }}
            />
            <div className="space-y-2">
              <label htmlFor={`blend-file-${source.number}`}>
                {t(source.number === 1 ? "Or upload Model 1 file" : "Or upload Model 2 file")}
              </label>
              <FileInput
                key={source.file?.name || "empty"}
                id={`blend-file-${source.number}`}
                accept=".pth"
                placeholder={source.file?.name}
                onFileSelect={source.setFile}
              />
              {source.file && (
                <Button variant="ghost" size="xs" onClick={() => source.setFile(null)}>
                  {t("Clear file selection")}
                </Button>
              )}
            </div>
            <details className="rounded-lg border border-[var(--border)] px-3 py-2">
              <summary className="cursor-pointer text-xs text-[var(--muted)]">
                {t("Advanced Settings")}
              </summary>
              <div className="space-y-2 pt-3">
                <label htmlFor={`blend-path-${source.number}`}>
                  {t(source.number === 1 ? "Path to first model" : "Path to second model")}
                </label>
                <input
                  id={`blend-path-${source.number}`}
                  value={source.path}
                  placeholder={`logs/model${source.number}.pth`}
                  onChange={(event) => {
                    source.setPath(event.target.value);
                    source.setFile(null);
                  }}
                />
              </div>
            </details>
          </Card>
        ))}
      </div>
      <Card className="space-y-5">
        <CardHeader
          icon={<Sparkles size={18} />}
          title={t("Model Fusion & Blending")}
          description={t("Merge and interpolate weights between two compatible voice model checkpoints.")}
          action={
            <Button variant="ghost" size="xs" icon={<RefreshCw size={13} />} onClick={() => setRatio(0.5)}>
              {t("Reset defaults")}
            </Button>
          }
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label htmlFor="blend-model-name">{t("Model Name")}</label>
            <input
              id="blend-model-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("my-fusion")}
              aria-describedby="blend-model-name-help"
            />
            <SettingHelp text={t(SETTING_HELP.modelName)} controlId="blend-model-name" />
          </div>
          <div className="space-y-3">
            <SliderField
              id="blend-ratio"
              label={t("Blend Ratio")}
              value={Math.round(ratio * 100)}
              min={0}
              max={100}
              step={1}
              unit="%"
              onChange={(percent) => setRatio(percent / 100)}
              description={t("Choose how much of Model 1 to keep. The rest comes from Model 2.")}
            />
            <div className="flex justify-between gap-4 text-xs text-[var(--muted)]">
              <span className="truncate">
                {t("Model 1")}: {Math.round(ratio * 100)}% · {fileBasename(f1?.name || p1) || "—"}
              </span>
              <span className="truncate text-right">
                {t("Model 2")}: {100 - Math.round(ratio * 100)}% · {fileBasename(f2?.name || p2) || "—"}
              </span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-[var(--input-bg)]" aria-hidden="true">
              <div className="bg-[var(--accent)] transition-[width]" style={{ width: `${ratio * 100}%` }} />
              <div className="flex-1 bg-[var(--muted)] opacity-50" />
            </div>
          </div>
        </div>
      </Card>
      <Card>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <p className="field-help flex items-center gap-2">
            <Sparkles size={16} />
            {t("Interpolate weights between two checkpoint files.")}
          </p>
          <Button
            type="submit"
            loading={busy}
            disabled={!name.trim() || (!p1 && !f1) || (!p2 && !f2)}
            icon={<Layers size={16} />}
          >
            {busy ? t("Blending…") : t("Fuse Models")}
          </Button>
        </div>
        <JobPanel jobId={jobId} embedded />
      </Card>
    </form>
  );
}
