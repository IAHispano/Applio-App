import fs from "node:fs";
import path from "node:path";
import { getCodeRoot } from "@/python";

// Read shipped identity from code, not an older seeded runtime assets folder.
export function desktopIssueUrl(): string {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(getCodeRoot(), "assets", "ecosystem.json"), "utf8"),
  ) as { projects: { desktop: { issues: string } } };
  return `${manifest.projects.desktop.issues}/new`;
}
