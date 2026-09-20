"use client";

import { Database, Download, Link2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import JobPanel from "@/components/JobPanel";
import { Alert, Button, Card, CardHeader, ToggleField } from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import { apiGet, apiSend, errMsg, postForm } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function DownloadPanel() {
  const { t } = useI18n();
  const [link, setLink] = useState("");
  const [linkJob, setLinkJob] = useState<string | null>(null);
  const [dropFile, setDropFile] = useState<File | null>(null);
  const [dropMsg, setDropMsg] = useState("");
  const [dropping, setDropping] = useState(false);
  const [pretrained, setPretrained] = useState<Array<{ name: string; sampleRates: string[] }>>([]);
  const [model, setModel] = useState("Titan");
  const [sr, setSr] = useState("40k");
  const [custom, setCustom] = useState(false);
  const [urlG, setUrlG] = useState("");
  const [urlD, setUrlD] = useState("");
  const [preJob, setPreJob] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet<{ models: Array<{ name: string; sampleRates: string[] }> }>("/api/download/pretraineds")
      .then((p) => {
        setPretrained(p.models);
        if (p.models[0]) {
          setModel(p.models[0].name);
          if (p.models[0].sampleRates[0]) setSr(p.models[0].sampleRates[0]);
        }
      })
      .catch((e) => setError(errMsg(e)));
  }, []);

  async function downloadLink() {
    setError("");
    try {
      const { jobId } = await apiSend<{ jobId: string }>("/api/download", "POST", { modelLink: link });
      setLinkJob(jobId);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function drop() {
    setDropMsg("");
    if (!dropFile || dropping) return;
    const fd = new FormData();
    fd.append("file", dropFile);
    setDropping(true);
    try {
      const r = await postForm<{ file: string; modelDir: string }>("/api/download/drop", fd);
      setDropMsg(`Saved ${r.file} → ${r.modelDir} ✓`);
      setDropFile(null);
    } catch (e) {
      setDropMsg(errMsg(e));
    } finally {
      setDropping(false);
    }
  }

  async function downloadPretrained() {
    setError("");
    try {
      const body = custom ? { urlG, urlD } : { model, sampleRate: sr };
      const { jobId } = await apiSend<{ jobId: string }>("/api/download/pretraineds", "POST", body);
      setPreJob(jobId);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert variant="error">{error}</Alert>}

      {/* Card 1: Download from URL */}
      <Card>
        <CardHeader
          icon={<Link2 size={18} className="text-white" />}
          title={t("Download from Link")}
          description={t(
            "Paste a model URL (HuggingFace, Google Drive, Mega, or direct zip) to download weights.",
          )}
        />

        <div className="flex flex-col sm:flex-row gap-3 max-w-xl">
          <label htmlFor="dl-link-input" className="sr-only">
            {t("Model Link")}
          </label>
          <input
            id="dl-link-input"
            type="text"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder={t("Model link (Drive, HuggingFace, direct zip)…")}
            className="flex-1 h-10 px-3 text-sm rounded-xl bg-white/5 border border-white/10"
          />
          <Button onClick={downloadLink} icon={<Download size={16} />}>
            {t("Download")}
          </Button>
        </div>

        <JobPanel jobId={linkJob} compact embedded />
      </Card>

      {/* Card 2: Upload Files */}
      <Card>
        <CardHeader
          icon={<Upload size={18} className="text-white shrink-0" />}
          title={t("Upload Model Files")}
          description={t("Upload local .pth, .index, or .onnx files directly into your models directory.")}
        />

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 max-w-xl">
          <label htmlFor="dl-file-input" className="sr-only">
            {t("Upload model file")}
          </label>
          <input
            id="dl-file-input"
            type="file"
            accept=".pth,.index,.onnx"
            onChange={(e) => setDropFile(e.target.files?.[0] || null)}
            className="flex-1"
          />
          <Button
            variant="ghost"
            onClick={drop}
            disabled={!dropFile || dropping}
            loading={dropping}
            icon={<Upload size={16} className="text-white" />}
          >
            {dropping ? t("Uploading…") : t("Save File")}
          </Button>
        </div>
        {dropMsg && (
          <p className="text-xs text-neutral-400 m-0" role="status" aria-live="polite">
            {dropMsg}
          </p>
        )}
      </Card>

      {/* Card 3: Pretrained Base Models */}
      <Card>
        <CardHeader
          icon={<Database size={18} className="text-white" />}
          title={t("Pretrained Base Models")}
          description={t("Download generator and discriminator checkpoints for training custom voices.")}
        />

        {!custom ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <div>
              <label htmlFor="dl-pretrained-select">{t("Pretrained")}</label>
              <CustomSelect
                id="dl-pretrained-select"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  const m = pretrained.find((p) => p.name === e.target.value);
                  if (m?.sampleRates[0]) setSr(m.sampleRates[0]);
                }}
                className="w-full mt-1"
              >
                {pretrained.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </CustomSelect>
            </div>
            <div>
              <label htmlFor="dl-sr-select">{t("Sampling Rate")}</label>
              <CustomSelect
                id="dl-sr-select"
                value={sr}
                onChange={(e) => setSr(e.target.value)}
                className="w-full mt-1"
              >
                {(pretrained.find((p) => p.name === model)?.sampleRates || [sr]).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </CustomSelect>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <div>
              <label htmlFor="dl-url-g">{t("Pretrained G")}</label>
              <input id="dl-url-g" type="text" value={urlG} onChange={(e) => setUrlG(e.target.value)} />
            </div>
            <div>
              <label htmlFor="dl-url-d">{t("Pretrained D")}</label>
              <input id="dl-url-d" type="text" value={urlD} onChange={(e) => setUrlD(e.target.value)} />
            </div>
          </div>
        )}

        <ToggleField
          id="dl-custom-checkbox"
          label={t("Custom Pretrained URLs")}
          checked={custom}
          onChange={setCustom}
          className="mt-3"
        />

        <div className="pt-3.5 border-t border-white/5 flex justify-end">
          <Button
            variant="ghost"
            onClick={downloadPretrained}
            icon={<Download size={16} className="text-white" />}
          >
            {t("Download Pretrained")}
          </Button>
        </div>

        <JobPanel jobId={preJob} embedded />
      </Card>
    </div>
  );
}
