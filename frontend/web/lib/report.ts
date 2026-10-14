import { ECOSYSTEM } from "@/lib/ecosystem";

export interface DiagnosticInfo {
  version: string;
  backendRevision?: string;
  platform: string;
  node: string;
  python: string;
  cpus: number;
  totalMemGB: number;
}

export function formatDiagnostics(info: DiagnosticInfo): string {
  return [
    `${ECOSYSTEM.projects.desktop.name} ${info.version}`,
    `Engine revision: ${info.backendRevision || "unknown"}`,
    info.platform,
    `Node ${info.node}`,
    info.python,
    `CPUs: ${info.cpus} · RAM: ${info.totalMemGB}GB`,
  ].join("\n");
}

export function issueReportUrl(info: DiagnosticInfo): string {
  const url = new URL(`${ECOSYSTEM.projects.desktop.issues}/new`);
  url.searchParams.set(
    "body",
    `**Describe the bug**\n\n**Steps to reproduce**\n\n**Expected behavior**\n\n**System**\n${formatDiagnostics(info)}`,
  );
  return url.href;
}
