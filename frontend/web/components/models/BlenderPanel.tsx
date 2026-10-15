"use client";

import { Layers, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import JobPanel from "@/components/JobPanel";
import { Alert, Badge, Button, Card, CardHeader, FileInput } from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import SettingHelp from "@/components/ui/SettingHelp";
import SliderField from "@/components/ui/SliderField";
import { errMsg, fetchModels, postForm } from "@/lib/api";
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
    <div className="space-y-4">
      {error && <Alert variant="error">{error}</Alert>}

      <form onSubmit={onSubmit} className="card-stack">
        <Card>
          <CardHeader
            icon={<Layers size={18} className="text-white" />}
            title={t("Model Fusion & Blending")}
            description={t("Merge and interpolate weights between two compatible voice model checkpoints.")}
            action={
              <Badge variant="neutral" size="sm">
                {models.length} {t("models detected")}
              </Badge>
            }
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="blend-model-name">{t("Model Name")}</label>
              <input
                id="blend-model-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("my-fusion")}
                aria-describedby={`${"blend-model-name"}-help`}
              />
              <SettingHelp text={t(SETTING_HELP.modelName)} controlId={"blend-model-name"} />
            </div>
            <div>
              <SliderField
                id="blend-ratio"
                label={`${t("Blend Ratio")} (0 = ${t("Model 2")}, 1 = ${t("Model 1")})`}
                value={ratio}
                min={0}
                max={1}
                step={0.05}
                onChange={setRatio}
                description={t(SETTING_HELP.blend)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="blend-model1-path">{t("Path to first model")}</label>
              {models.length > 0 ? (
                <CustomSelect
                  id="blend-model1-path"
                  value={p1}
                  onChange={(e) => setP1(e.target.value)}
                  placeholder={t("Select Model 1…")}
                  className="w-full"
                  description={t(SETTING_HELP.blendModel)}
                >
                  <option value="">{t("Select Model 1…")}</option>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </CustomSelect>
              ) : (
                <>
                  <input
                    id="blend-model1-path"
                    type="text"
                    value={p1}
                    onChange={(e) => setP1(e.target.value)}
                    placeholder="logs/model1.pth"
                    aria-describedby={`${"blend-model1-path"}-help`}
                  />
                  <SettingHelp text={t(SETTING_HELP.blendModel)} controlId={"blend-model1-path"} />
                </>
              )}
              <label htmlFor="blend-model1-file" className="block text-xs text-neutral-400">
                {t("Or upload Model 1 file")}
              </label>
              <FileInput id="blend-model1-file" accept=".pth" onFileSelect={setF1} />
            </div>

            <div className="space-y-2">
              <label htmlFor="blend-model2-path">{t("Path to second model")}</label>
              {models.length > 0 ? (
                <CustomSelect
                  id="blend-model2-path"
                  value={p2}
                  onChange={(e) => setP2(e.target.value)}
                  placeholder={t("Select Model 2…")}
                  className="w-full"
                  description={t(SETTING_HELP.blendModel)}
                >
                  <option value="">{t("Select Model 2…")}</option>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </CustomSelect>
              ) : (
                <>
                  <input
                    id="blend-model2-path"
                    type="text"
                    value={p2}
                    onChange={(e) => setP2(e.target.value)}
                    placeholder="logs/model2.pth"
                    aria-describedby={`${"blend-model2-path"}-help`}
                  />
                  <SettingHelp text={t(SETTING_HELP.blendModel)} controlId={"blend-model2-path"} />
                </>
              )}
              <label htmlFor="blend-model2-file" className="block text-xs text-neutral-400">
                {t("Or upload Model 2 file")}
              </label>
              <FileInput id="blend-model2-file" accept=".pth" onFileSelect={setF2} />
            </div>
          </div>
        </Card>

        {/* Action card */}
        <Card>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <Sparkles size={16} className="text-white shrink-0" />
              <span>{t("Interpolate weights between two checkpoint files.")}</span>
            </div>
            <Button
              type="submit"
              disabled={busy || !name.trim() || (!p1 && !f1) || (!p2 && !f2)}
              icon={<Layers size={16} />}
              className="w-full sm:w-auto"
            >
              {busy ? t("Blending…") : t("Fuse Models")}
            </Button>
          </div>

          <JobPanel jobId={jobId} embedded />
        </Card>
      </form>
    </div>
  );
}
