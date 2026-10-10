export function errMsg(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
    if (typeof obj.stderr === "string" && obj.stderr.trim()) return obj.stderr.trim();
  }
  return String(err);
}

export function errDetails(err: unknown): string {
  if (err instanceof Error) {
    const parts: string[] = [];
    if (err.stack) parts.push(err.stack);
    else parts.push(err.message);

    const extra = err as unknown as Record<string, unknown>;
    if (typeof extra.stderr === "string" && extra.stderr.trim()) {
      parts.push(`--- Standard Error ---\n${extra.stderr.trim()}`);
    }
    if (typeof extra.stdout === "string" && extra.stdout.trim()) {
      parts.push(`--- Standard Output ---\n${extra.stdout.trim()}`);
    }
    if ("cause" in err && err.cause) {
      parts.push(`--- Cause ---\n${errDetails(err.cause)}`);
    }
    return parts.join("\n\n");
  }
  if (typeof err === "object" && err !== null) {
    try {
      return JSON.stringify(err, null, 2);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

export function apiError(err: unknown, fallbackMessage?: string): { error: string; details?: string } {
  const error = errMsg(err) || fallbackMessage || "Internal server error";
  const details = errDetails(err);
  return {
    error,
    ...(details && details !== error ? { details } : {}),
  };
}

export function explainExitCode(code: number | null | undefined): string | null {
  if (code === null || code === undefined || code === 0) return null;
  const unsigned = code >>> 0;
  if (code === 3221225477 || unsigned === 0xc0000005 || code === -1073741819) {
    return "Windows Access Violation (0xC0000005 / Segmentation fault) — Process or native GPU library crashed unexpectedly.";
  }
  if (code === 3221225781 || unsigned === 0xc0000135 || code === -1073741515) {
    return "Missing DLL Dependency (0xC0000135) — A required native library was not found in PATH.";
  }
  if (code === 3221225785 || unsigned === 0xc0000139 || code === -1073741511) {
    return "DLL Entry Point Not Found (0xC0000139) — Incompatible DLL version or missing function export.";
  }
  if (code === 3221226505 || unsigned === 0xc0000409 || code === -1073740791) {
    return "Stack Buffer Overrun / Abort (0xC0000409) — Process aborted.";
  }
  if (code === 139) {
    return "Segmentation fault (SIGSEGV / exit code 139).";
  }
  if (code === 134) {
    return "Process abort (SIGABRT / exit code 134).";
  }
  return null;
}
