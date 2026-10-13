export type SetupLineKind =
  | "hide"
  | "command"
  | "stage"
  | "download"
  | "success"
  | "error"
  | "warning"
  | "info"
  | "muted"
  | "text";

export interface ParsedSetupLine {
  kind: SetupLineKind;
  /** Display text with long paths shortened (original kept in `raw`). */
  pretty: string;
  raw: string;
  /** Only set for kind === "download". */
  download?: { done: boolean; pkg: string; size: string | null };
}

/** Lines the UI should not render at all. */
export function isHiddenSetupLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^={4,}|^-{4,}$/.test(t)) return true;
  if (t === "+") return true;
  if (/^(downloading|downloaded)$/i.test(t)) return true;
  return false;
}

/**
 * Re-join word-wrapped installer output before rendering:
 * - `Downloading` + `fonttools (2.4MiB)` -> one line
 * - `Downloaded` + `torchaudio` -> one line
 * - `Downloading cpython... (download)` + `(21.0MiB)` -> one line
 * - `Using CPython` + `3.12.15` -> one line
 */
export function mergeSetupLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const curRaw = lines[i] ?? "";
    let cur = curRaw.trim();
    if (!cur) continue;
    let j = i + 1;
    // Absorb wrapped continuations so each logical row renders once. The loop
    // (not single-step ifs) handles 3+ fragment runs like
    // `attrs` / `==26.` / `1.` / `0` -> `attrs==26.1.0`.
    for (;;) {
      const nxt = (lines[j] ?? "").trim();
      if (!nxt) break;
      // uv `+ pkg==version` rows wrapped mid-token: join without a space.
      if (/^==/.test(nxt) && /^[\w.!+~-]+$/.test(cur)) {
        cur += nxt;
        j++;
        continue;
      }
      if ((/=$/.test(cur) || /==.*[\d.]$/.test(cur) || /^==[\d.]*$/.test(cur)) && /^[\d.]+$/.test(nxt)) {
        cur += nxt;
        j++;
        continue;
      }
      if (/^(downloading|downloaded)$/i.test(cur)) {
        cur += ` ${nxt}`;
        j++;
        continue;
      }
      if (/^(downloading|downloaded)\b/i.test(cur) && /^\([^)]+\)$/.test(nxt)) {
        cur += ` ${nxt}`;
        j++;
        continue;
      }
      if (/^using cpython$/i.test(cur) && /^[\d.]+$/.test(nxt)) {
        cur += ` ${nxt}`;
        j++;
        continue;
      }
      break;
    }
    out.push(j > i + 1 ? cur : curRaw);
    i = j - 1;
  }
  return out;
}

function shortenToken(tok: string): string {
  if (/^https?:\/\//i.test(tok)) return tok;
  if (tok.length <= 56) return tok;
  const parts = tok.split(/[\\/]/);
  if (parts.length >= 3) return `…/${parts.slice(-2).join("/")}`;
  return `${tok.slice(0, 24)}…${tok.slice(-24)}`;
}

/** Replace home dirs and collapse very long path tokens. */
export function prettifySetupLine(line: string): string {
  const home = line
    .replace(/C:\\Users\\[^\\/\s]+/g, "~")
    // Long managed-data prefixes collapse to a short marker.
    .replace(/~[\\/]AppData[\\/]Local[\\/]Programs[\\/]Applio[\\/]data[\\/]/g, "…/Applio/data/")
    .replace(/~[\\/]\.config[\\/]Applio[\\/]data[\\/]/g, "…/Applio/data/");
  return home
    .split(/(\s+)/)
    .map((frag) => (/^\s+$/.test(frag) ? frag : shortenToken(frag)))
    .join("");
}

function parseDownload(text: string): { done: boolean; pkg: string; size: string | null } | null {
  const m = text.match(/^(downloading|downloaded)\s+(.+?)(?:\s+(\([^)]+\)))?\s*$/i);
  if (!m) return null;
  return { done: m[1].toLowerCase() === "downloaded", pkg: m[2].trim(), size: m[3] ?? null };
}

function isCommandLine(t: string): boolean {
  if (t.startsWith("$ ")) return true;
  if (/^(powershell|winget|uv|uvx|pip|python|python3|pnpm|npm|curl|brew)(\s|$)/i.test(t)) return true;
  if (/^([A-Z]:[\\/]|~[\\/]).*\.exe(\s|$)/i.test(t)) return true;
  if (/^[A-Z]:[\\/]\S+\s+\S+/i.test(t)) return true;
  return false;
}

export function parseSetupLine(line: string): ParsedSetupLine {
  const raw = line;
  const t = line.trim();

  if (isHiddenSetupLine(t)) return { kind: "hide", pretty: "", raw };

  // Errors first — they must win over "Downloaded"/"Installing" prefixes.
  if (
    t.startsWith("✗") ||
    t.startsWith("Error:") ||
    t.startsWith("ERROR:") ||
    t.startsWith("[ERR]") ||
    t.startsWith("DETAILS:") ||
    /traceback \(most recent call last\)/i.test(t) ||
    /exited with code/i.test(t) ||
    /failed to (start|install|download)/i.test(t)
  ) {
    return { kind: "error", pretty: prettifySetupLine(t), raw };
  }

  if (
    t.startsWith("!") ||
    t.startsWith("[!]") ||
    t.startsWith("Warning:") ||
    t.startsWith("WARNING:") ||
    t.startsWith("Note:") ||
    /^Note:/.test(t)
  ) {
    return { kind: "warning", pretty: prettifySetupLine(t), raw };
  }

  const dl = parseDownload(t);
  if (dl) {
    return { kind: "download", pretty: prettifySetupLine(t), raw, download: dl };
  }

  if (isCommandLine(t)) {
    const pretty = prettifySetupLine(t.startsWith("$ ") ? t.slice(2) : t);
    return { kind: "command", pretty, raw };
  }

  // Success markers (✓ headers, installer confirmations, resolve summaries).
  if (
    t.startsWith("✓") ||
    t.startsWith("✔") ||
    /^successfully installed/i.test(t) ||
    /everything'?s installed!/i.test(t) ||
    /installed successfully/i.test(t) ||
    /already exists ✓/.test(t) ||
    /acceleration is ready/i.test(t) ||
    /all systems go/i.test(t) ||
    /passed ✓|ready ✓|installed ✓/.test(t) ||
    /^setup complete/i.test(t) ||
    /^resolved \d+ packages/i.test(t)
  ) {
    return { kind: "success", pretty: prettifySetupLine(t.replace(/^[✓✔]\s*/, "")), raw };
  }

  // Environment / hardware probes worth highlighting.
  if (
    /^(nvidia gpu|nvidia driver|pytorch cuda|torch cuda|no nvidia|legacy nvidia|gpu predates|using python env|using uv|target architecture:)/i.test(
      t,
    )
  ) {
    return { kind: "info", pretty: prettifySetupLine(t), raw };
  }

  // Stage headers: "Installing …", "Creating …", "Using …" etc.
  if (
    /^(installing|creating|using|building|verifying|configuring|resolving|ensuring|running|removing|replacing|uninstalling|downloading default|installing web|installing engine|installing uv|creating app|downloading base|building web|verifying installation|attempting|no system python|downloading python|downloading vc)/i.test(
      t,
    )
  ) {
    return { kind: "stage", pretty: prettifySetupLine(t), raw };
  }

  // Low-signal installer chatter: lone sizes, file names, versions,
  // and uv's `+ pkg==version` added-package rows.
  if (
    /^\([^)]+\)$/.test(t) ||
    /^[\w.-]+\.(exe|whl|dll)$/i.test(t) ||
    /^[\d.]+$/.test(t) ||
    /^\.[\d.]+$/.test(t) ||
    /^==/.test(t) ||
    /^pip==/i.test(t) ||
    /^\+ [\w.-]+==/.test(t) ||
    /^[\w.+~-]+==\S+/.test(t) ||
    /^activate with:/i.test(t) ||
    /^creating virtual environment with seed/i.test(t) ||
    /^using cpython/i.test(t)
  ) {
    return { kind: "muted", pretty: prettifySetupLine(t), raw };
  }

  return { kind: "text", pretty: prettifySetupLine(t), raw };
}
