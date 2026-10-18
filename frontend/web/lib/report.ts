import { ECOSYSTEM } from "@/lib/ecosystem";

export interface DiagnosticInfo {
  version: string;
  backendRevision?: string;
  platform: string;
  node?: string;
  runtime?: string;
  python: string;
  cpus: number;
  totalMemGB: number;
}

export function diagnosticRuntime(info: Pick<DiagnosticInfo, "node" | "runtime">): string {
  return info.runtime || (info.node ? `Node ${info.node}` : "Rust");
}

export function formatDiagnostics(info: DiagnosticInfo): string {
  return [
    `${ECOSYSTEM.projects.desktop.name} ${info.version}`,
    `Engine revision: ${info.backendRevision || "unknown"}`,
    info.platform,
    diagnosticRuntime(info),
    info.python,
    `CPUs: ${info.cpus} · RAM: ${info.totalMemGB}GB`,
  ].join("\n");
}

export function issueReportUrl(info: DiagnosticInfo): string {
  const url = new URL(`${ECOSYSTEM.projects.desktop.issues}/new`);
  // Open the guided form so diagnostics cannot replace the required report.
  url.searchParams.set("template", "BUG.yml");
  url.searchParams.set("system", formatDiagnostics(info));
  return url.href;
}
