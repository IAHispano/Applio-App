import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Relaunch inherits this process's environment, not the installer's updated PATH.
export async function refreshSetupPath(): Promise<void> {
  if (process.platform !== "win32") return;
  const parts = (process.env.PATH || "").split(";").filter(Boolean);
  for (const key of [
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
    "HKCU\\Environment",
  ]) {
    try {
      const { stdout } = await run("reg.exe", ["query", key, "/v", "Path"], {
        windowsHide: true,
        timeout: 5000,
      });
      const raw = stdout.match(/Path\s+REG_(?:EXPAND_)?SZ\s+([^\r\n]+)/i)?.[1];
      for (const item of (raw || "").split(";")) {
        const expanded = item.trim().replace(/%([^%]+)%/g, (original, name: string) => {
          const key = Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase());
          return (key && process.env[key]) || original;
        });
        if (expanded && !parts.some((part) => part.toLowerCase() === expanded.toLowerCase())) {
          parts.push(expanded);
        }
      }
    } catch {
      // A missing registry key must not prevent restarting the installed environment.
    }
  }
  process.env.PATH = parts.join(";");
}

export function isCompletedSetup(job: unknown): boolean {
  if (!job || typeof job !== "object") return false;
  const value = job as { status?: string; params?: { setup?: unknown }; result?: { ready?: unknown } };
  return value.status === "done" && value.params?.setup === true && value.result?.ready === true;
}
