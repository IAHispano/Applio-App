export type ConsoleEvent =
  | { kind: "phase"; key: string; index: number; total: number; title: string }
  | { kind: "progress"; key: string; phase: string; percent: number; detail: string }
  | { kind: "task"; key: string; title: string; meta: string; status: "running" | "done"; percent: number | null; detail: string; duration: string | null }
  | { kind: "message"; key: string; text: string; tone: "info" | "success" | "muted" }
  | { kind: "error"; key: string; lines: Array<{ key: string; text: string }> };

const PHASE_RE = /^>>>\s*\[(\d+)\/(\d+)\]\s*(.*?)\s*\.?\s*$/;
const TQDM_RE = /(\d{1,3})%\s*\|[^|]*\|\s*([\d.]+\/[\d.]+)?\s*\[([^\]]*)\]/;
// "Starting pitch extraction on cuda:0 using rmvpe..." → task row.
const TASK_START_RE = /^Starting (pitch|embedding) extraction\b\s*(.*?)\s*\.\.\.$/i;
// "Pitch extraction completed in 10.10 seconds." → closes the task.
const TASK_DONE_RE = /^(pitch|embedding) extraction completed in ([\d.]+) seconds\.$/i;
const ERROR_RE = /error|fail|exception|traceback/i;

function isContinuationOfError(line: string): boolean {
  const t = line.trim();
  return (
    t.startsWith("File ") ||
    t.startsWith("line ") ||
    t.startsWith("During ") ||
    t.startsWith("The above ") ||
    t.startsWith("raise ") ||
    t.startsWith("return ") ||
    t.startsWith("hp, ") ||
    /^\^+$/.test(t) ||
    (/^[a-zA-Z_][\w.]*Error/.test(t) && t.includes(":"))
  );
}

function messageTone(text: string): "info" | "success" | "muted" {
  if (/completed|successfully|^saved |model .* (downloaded|preprocessed)/i.test(text)) return "success";
  if (/^starting |^saving |^loading |^using |^downloading/i.test(text)) return "muted";
  return "info";
}

/**
 * Turn raw terminal log lines into UI timeline events:
 * - `>>> [n/m] Title` markers become phase separators
 * - tqdm progress redraws collapse into one live bar per phase
 * - "Starting X extraction ..." / "X extraction completed in Ns" pairs merge
 *   into a single task row (no split start/completed lines)
 * - everything else becomes a message, errors merge into blocks
 */
export function parseConsoleEvents(lines: string[], terminal = false): ConsoleEvent[] {
  const events: ConsoleEvent[] = [];
  const progressByPhase = new Map<string, ConsoleEvent>();
  let currentPhase = "";
  let counter = 0;
  const key = () => `ev-${counter++}`;

  const pushProgress = (percent: number, detail: string) => {
    // tqdm lines inside an open extraction task feed that task's bar.
    const openTask = [...events].reverse().find((e) => e.kind === "task" && e.status === "running");
    if (openTask?.kind === "task") {
      openTask.percent = percent;
      openTask.detail = detail;
      return;
    }
    const phaseKey = currentPhase || "global";
    const existing = progressByPhase.get(phaseKey);
    if (existing && existing.kind === "progress") {
      existing.percent = percent;
      existing.detail = detail;
      return;
    }
    const ev: ConsoleEvent = { kind: "progress", key: key(), phase: currentPhase, percent, detail };
    progressByPhase.set(phaseKey, ev);
    events.push(ev);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const phase = line.match(PHASE_RE);
    if (phase) {
      currentPhase = phase[3].trim().replace(/\.*$/, "");
      events.push({
        kind: "phase",
        key: key(),
        index: Number(phase[1]),
        total: Number(phase[2]),
        title: currentPhase,
      });
      continue;
    }

    const taskStart = line.match(TASK_START_RE);
    if (taskStart) {
      const name = taskStart[1].toLowerCase() === "pitch" ? "Pitch extraction" : "Embedding extraction";
      const meta = taskStart[2].replace(/^(on|with)\s+/i, "").trim();
      events.push({ kind: "task", key: key(), title: name, meta, status: "running", percent: null, detail: "", duration: null });
      continue;
    }

    const taskDone = line.match(TASK_DONE_RE);
    if (taskDone) {
      const name = taskDone[1].toLowerCase() === "pitch" ? "Pitch extraction" : "Embedding extraction";
      const openTask = [...events]
        .reverse()
        .find((e) => e.kind === "task" && e.status === "running" && e.title === name);
      if (openTask?.kind === "task") {
        openTask.status = "done";
        openTask.percent = 100;
        openTask.duration = `${taskDone[2]}s`;
      } else {
        events.push({
          kind: "task",
          key: key(),
          title: name,
          meta: "",
          status: "done",
          percent: 100,
          detail: "",
          duration: `${taskDone[2]}s`,
        });
      }
      continue;
    }

    const tqdm = line.match(TQDM_RE);
    if (tqdm) {
      const percent = Math.max(0, Math.min(100, Number(tqdm[1])));
      const fraction = (tqdm[2] || "").trim();
      const speed = (tqdm[3] || "").trim();
      const detail = [fraction, speed].filter(Boolean).join(" · ");
      pushProgress(percent, detail);
      continue;
    }

    const last = events[events.length - 1];
    if (ERROR_RE.test(line) || (last?.kind === "error" && isContinuationOfError(line))) {
      const numbered = { key: `errline-${counter++}`, text: line };
      if (last?.kind === "error") last.lines.push(numbered);
      else events.push({ kind: "error", key: key(), lines: [numbered] });
      continue;
    }

    events.push({ kind: "message", key: key(), text: line, tone: messageTone(line) });
  }

  if (terminal) {
    // A killed/finished job must not leave a task row spinning forever.
    for (const ev of events) {
      if (ev.kind === "task" && ev.status === "running") ev.status = "done";
    }
  }

  return events;
}

/** Plain-text haystack for search/filter pills. */
export function eventText(ev: ConsoleEvent): string {
  switch (ev.kind) {
    case "phase":
      return `${ev.title} phase ${ev.index}`;
    case "progress":
      return `${ev.phase} ${ev.percent} ${ev.detail}`;
    case "task":
      return `${ev.title} ${ev.meta} ${ev.detail} ${ev.duration ?? ""}`;
    case "message":
      return ev.text;
    case "error":
      return ev.lines.map((l) => l.text).join("\n");
  }
}
