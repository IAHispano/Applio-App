"use client";

import { BookOpen, Check, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, CustomSelect } from "@/components/ui";
import { apiGet, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface Operation {
  method: string;
  path: string;
  group: string;
  response: string;
  encoding?: string;
  example: Record<string, unknown>;
  query?: Record<string, string>;
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  files?: Record<
    string,
    { extensions: string[]; multiple?: boolean; maxBytes?: number; maxFiles?: number; required?: boolean }
  >;
}

const EXAMPLE_PARAMETERS: Record<string, string> = {
  id: "JOB_ID",
  item: "0",
  clip: "CLIP_ID",
  name: "logs%2Fvoice%2Fvoice.pth",
};
function examplePath(path: string) {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => EXAMPLE_PARAMETERS[name] || name.toUpperCase());
}
const shell = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
export function curlExample(base: string, operation: Operation): string {
  const query = new URLSearchParams(operation.query || {}).toString();
  const url = `${base}${examplePath(operation.path)}${query ? `?${query}` : ""}`;
  if (operation.response === "websocket") {
    return `websocat -H "Authorization: Bearer $APPLIO_API_KEY" ${shell(url.replace(/^http/, "ws"))}\n\n# First JSON message\n${JSON.stringify(operation.example, null, 2)}`;
  }
  const lines = [
    `curl${operation.response === "sse" ? " -N" : ""} -X ${operation.method} ${shell(url)}`,
    '  -H "Authorization: Bearer $APPLIO_API_KEY"',
  ];
  if (["POST", "PUT"].includes(operation.method)) {
    if (operation.encoding === "multipart/form-data") {
      for (const [field, value] of Object.entries(operation.example))
        lines.push(`  -F ${shell(`${field}=${typeof value === "object" ? JSON.stringify(value) : value}`)}`);
      for (const [field, file] of Object.entries(operation.files || {}))
        lines.push(`  -F ${shell(`${field}=@input.${file.extensions[0] || "wav"}`)}`);
    } else if (Object.keys(operation.example).length) {
      lines.push(
        '  -H "Content-Type: application/json"',
        `  --data ${shell(JSON.stringify(operation.example))}`,
      );
    }
  }
  if (operation.response === "file") lines.push("  --output downloaded-file");
  return lines.join(" \\\n");
}

function pythonJson(value: unknown): string {
  return `json.loads(r'''${JSON.stringify(value, null, 2).replace(/'/g, "\\u0027")}''')`;
}

export function pythonExample(base: string, operation: Operation): string {
  const body = pythonJson(operation.example);
  let code = `# pip install requests\nimport json, os, time\nfrom contextlib import ExitStack\nfrom pathlib import Path\nimport requests\n\nbase = ${JSON.stringify(base)}\nheaders = {"Authorization": "Bearer " + os.environ["APPLIO_API_KEY"]}\nurl = base + ${JSON.stringify(examplePath(operation.path))}\nparams = ${pythonJson(operation.query || {})}\npayload = ${body}\n`;
  if (operation.response === "websocket")
    return `# pip install websockets\nimport json, os\nfrom websockets.sync.client import connect\n\nurl = ${JSON.stringify(`${base}${examplePath(operation.path)}`.replace(/^http/, "ws"))}\nheaders = {"Authorization": "Bearer " + os.environ["APPLIO_API_KEY"]}\npayload = ${body}\nwith connect(url, additional_headers=headers, open_timeout=30) as socket:\n    socket.send(json.dumps(payload))\n    print(socket.recv())\n    ${operation.path.endsWith("/ws-audio") ? "# After ready: send mono 48 kHz little-endian Float32 PCM.\n    # Each block has ready.block_frame samples; wait for a binary reply.\n    # Handle JSON status/config/error messages between audio replies." : "# Receive config_applied or config_error with the matching id."}`;
  if (operation.encoding === "multipart/form-data") {
    code += `\nwith ExitStack() as stack:\n    files = [\n${Object.entries(operation.files || {})
      .map(
        ([field, file]) =>
          `        (${JSON.stringify(field)}, stack.enter_context(open("input.${file.extensions[0] || "wav"}", "rb"))),`,
      )
      .join(
        "\n",
      )}\n    ]\n    response = requests.request(${JSON.stringify(operation.method)}, url, headers=headers,\n        params=params, data={key: json.dumps(value) if isinstance(value, (dict, list, bool)) else value for key, value in payload.items()},\n        files=files, timeout=600)\n`;
  } else {
    code += `\nresponse = requests.request(${JSON.stringify(operation.method)}, url, headers=headers, params=params,\n    ${["POST", "PUT"].includes(operation.method) ? "json=payload, " : ""}${operation.response === "sse" ? "stream=True, timeout=(10, 90)" : "timeout=600"})\n`;
  }
  code += "response.raise_for_status()\n";
  if (operation.response === "file") return `${code}Path("downloaded-file").write_bytes(response.content)`;
  if (operation.response === "sse")
    return `${code}try:\n    for line in response.iter_lines(decode_unicode=True):\n        if line:\n            print(line)\nfinally:\n    response.close()`;
  code += "result = response.json()\nprint(result)";
  if (operation.response === "job")
    code += `\n\njob_id = result["jobId"]\nwhile True:\n    status = requests.get(base + "/v1/jobs/" + job_id, headers=headers, timeout=30)\n    status.raise_for_status()\n    job = status.json()["job"]\n    if job["status"] == "error":\n        raise RuntimeError(job.get("error", "Job failed or cancelled"))\n    if job["status"] == "done":\n        break\n    time.sleep(1)\n\nartifacts = requests.get(base + "/v1/jobs/" + job_id + "/artifacts", headers=headers, timeout=30)\nartifacts.raise_for_status()\nfor artifact in artifacts.json()["artifacts"]:\n    output = requests.get(base + artifact["url"], headers=headers, timeout=600)\n    output.raise_for_status()\n    Path(Path(artifact["name"]).name).write_bytes(output.content)\n\n# Cancel queued/running work when needed:\n# requests.post(base + "/v1/jobs/" + job_id + "/cancel", headers=headers, timeout=30).raise_for_status()`;
  return code;
}

export default function ApiReference({ base }: { base: string }) {
  const { t } = useI18n();
  const [operations, setOperations] = useState<Operation[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [selected, setSelected] = useState("POST /v1/applio/inference");
  const [language, setLanguage] = useState("curl");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    apiGet<Operation[]>("/api/integrations/catalog")
      .then((data) => {
        if (active) setOperations(data);
      })
      .catch((error) => {
        if (active) setError(errMsg(error));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  const visible = useMemo(
    () =>
      operations.filter(
        (operation) =>
          (!group || operation.group === group) &&
          `${operation.method} ${operation.path} ${t(operation.group)}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [operations, search, group, t],
  );
  const operation =
    visible.find((operation) => `${operation.method} ${operation.path}` === selected) || visible[0];
  const code = operation
    ? language === "python"
      ? pythonExample(base, operation)
      : curlExample(base, operation)
    : "";
  return (
    <Card id="api-reference" className="space-y-5 scroll-mt-6">
      <CardHeader
        icon={<BookOpen size={18} />}
        title={t("API reference")}
        description={t(
          "Use /v1/applio for the full app API. Paths and enum values match the app; OpenAI compatibility applies to /v1/models and /v1/audio/speech.",
        )}
      />
      {error && (
        <Alert variant="error" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}
      <p className="field-help">
        {t(
          "API keys grant full local app control, including model deletion, plugin installation, settings, and setup. Keep them private.",
        )}
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-5 items-start">
        <div className="space-y-3 min-w-0">
          <input
            type="search"
            className="form-control"
            aria-label={t("Search endpoints")}
            placeholder={t("Search endpoints")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <label htmlFor="api-operation-group" className="sr-only">
            {t("API reference")}
          </label>
          <CustomSelect
            id="api-operation-group"
            value={group}
            onValueChange={setGroup}
            options={[
              { value: "", label: t("All") },
              ...Array.from(new Set(operations.map((operation) => operation.group))).map((group) => ({
                value: group,
                label: t(group),
              })),
            ]}
          />
          <div className="text-xs text-[var(--muted)]">
            {visible.length} / {operations.length}
          </div>
          <nav aria-label={t("API reference")} className="api-reference-list">
            {visible.map((item) => (
              <button
                type="button"
                key={`${item.method} ${item.path}`}
                aria-current={item === operation ? "true" : undefined}
                onClick={() => setSelected(`${item.method} ${item.path}`)}
              >
                <span className="text-[var(--accent)] text-[10px]">{item.method}</span>
                <code>{item.path.replace("/v1/applio/", "")}</code>
              </button>
            ))}
          </nav>
        </div>
        {operation && (
          <div className="space-y-4 min-w-0">
            <div className="flex flex-wrap gap-2 items-center">
              <Badge>{operation.method}</Badge>
              <code className="text-xs break-all">{operation.path}</code>
            </div>
            <p className="field-help">
              {t("Response")}:{" "}
              <code>
                {
                  (
                    {
                      job: "202 · {jobId}",
                      json: "200 · application/json",
                      file: "200/206 · file",
                      sse: "200 · text/event-stream",
                      websocket: "101 · WebSocket",
                    } as Record<string, string>
                  )[operation.response]
                }
              </code>
            </p>
            {operation.query && (
              <details>
                <summary>{t("Query parameters")}</summary>
                <pre className="api-code mt-3">{JSON.stringify(operation.query, null, 2)}</pre>
              </details>
            )}
            <details open key={operation.path + operation.method}>
              <summary>{t("Parameters")}</summary>
              <div className="api-parameter-list">
                {Object.entries(operation.properties).map(([name, schema]) => (
                  <div key={name}>
                    <div className="flex gap-2 flex-wrap items-center">
                      <code>{name}</code>
                      <span className="field-help">
                        {t(operation.required.includes(name) ? "Required" : "Optional")}
                      </span>
                    </div>
                    <code>{JSON.stringify(schema)}</code>
                  </div>
                ))}
                {Object.entries(operation.files || {}).map(([name, file]) => (
                  <div key={name}>
                    <code>{name}</code>
                    <code>multipart · {JSON.stringify(file)}</code>
                  </div>
                ))}
              </div>
            </details>
            <div className="flex gap-2 items-center">
              <Button
                size="xs"
                variant={language === "curl" ? "primary" : "ghost"}
                aria-pressed={language === "curl"}
                onClick={() => setLanguage("curl")}
              >
                cURL
              </Button>
              <Button
                size="xs"
                variant={language === "python" ? "primary" : "ghost"}
                aria-pressed={language === "python"}
                onClick={() => setLanguage("python")}
              >
                Python
              </Button>
              <Button
                size="xs"
                variant="ghost"
                icon={copied ? <Check size={12} /> : <Copy size={12} />}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(code)
                    .then(() => setCopied(true))
                    .catch(() => setError(t("Could not copy. Select and copy the text manually.")));
                }}
              >
                {t("Copy")}
              </Button>
            </div>
            <pre className="api-code">
              <code>{code}</code>
            </pre>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-[var(--muted)] leading-relaxed">
        {[
          "HTTP 202 returns jobId. Poll until done or error, then list artifacts and download their authenticated URLs.",
          "Files are read on the Applio host. Upload files from another machine with multipart/form-data. Blend ratio is 0–1; 25% means 0.25.",
          "Send Bearer authorization on HTTP requests, SSE connections, and WebSocket handshakes. Browser WebSocket clients need a local server proxy; never put keys in URLs.",
          "Realtime: start the service, send init JSON over ws-audio, wait for ready, then send mono 48 kHz Float32 PCM blocks of block_frame samples. Wait for each binary reply before sending the next block. Stop the service when finished.",
          "Native responses may contain /api or /outputs URLs. Use /v1/applio for API routes and the job artifact endpoints for authenticated downloads.",
          "Native window controls, file dialogs, and signed desktop updates require the desktop app.",
        ].map((text) => (
          <p key={text} className="m-0 rounded-lg border border-[var(--border)] p-3">
            {t(text)}
          </p>
        ))}
      </div>
    </Card>
  );
}
