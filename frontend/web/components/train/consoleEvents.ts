import { parseLogProgress, parseTrainingProgress } from "@/lib/log-progress";

export type ConsoleEvent =
  | { kind: "phase"; key: string; index: number; total: number; title: string }
  | { kind: "progress"; key: string; phase: string; percent: number; detail: string }
  | {
      kind: "task";
      key: string;
      title: string;
      meta: string;
      status: "running" | "done";
      percent: number | null;
      detail: string;
      duration: string | null;
    }
  | { kind: "message"; key: string; text: string; tone: "info" | "success" | "muted" }
  | { kind: "error"; key: string; lines: Array<{ key: string; text: string }> }
  | {
      kind: "epoch";
      key: string;
      model: string;
      epoch: number;
      step: number;
      time: string;
      speed: string;
      loss: { value: string; epoch: number; step: number } | null;
    }
  | { kind: "save"; key: string; filename: string; epoch: number; step: number | null };

const PHASE_RE = /^>>>\s*\[(\d+)\/(\d+)\]\s*(.*?)\s*\.?\s*$/;
// "model | epoch=15 | step=360 | time=00:06:17 | training_speed=0:00:09
//  | lowest_value=11.701 (epoch 14 and step 329)" — one structured row.
const EPOCH_RE =
  /^(.+?)\s*\|\s*epoch=(\d+)\s*\|\s*step=(\d+)\s*\|\s*time=([0-9:]+)\s*\|\s*training_speed=([0-9:]+)(?:\s*\|\s*lowest_value=([0-9.]+)\s*\(epoch\s*(\d+)\s*and\s*step\s*(\d+)\))?/;
const TASK_START_RE = /^Starting (pitch|embedding) extraction\b\s*(.*?)\s*\.\.\.$/i;
// "Pitch extraction completed in 10.10 seconds." → closes the task.
const TASK_DONE_RE =
  /^(pitch|embedding) extraction completed in ([\d.]+) seconds(?: \(\d+\/\d+ files successful\))?\.$/i;
// "Saved model 'C:\...\G_2333333.pth' (epoch 30)" and
// "Saved model 'C:\...\model_30e_720s.pth' (epoch 30 and step 720)".
const SAVE_RE = /^Saved model '(.+)' \(epoch (\d+)(?: and step (\d+))?\)\s*$/;
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
 * Split raw log entries into display fragments. Backend log entries are
 * arbitrary stdout chunks: tqdm redraws glue many updates into one entry
 * with \r separators, so anchored patterns (phase/task markers) would miss
 * when sharing an entry. Splitting first makes every downstream match exact.
 */
export function splitLogFragments(lines: string[]): string[] {
  const out: string[] = [];
  for (const entry of lines) {
    // Note: ANSI codes are already stripped by the API (appendChunkLogs),
    // so every stored line matches anchored patterns directly.
    for (const frag of entry.split(/\r+\n?|\n/)) {
      const text = frag.trim();
      if (text) out.push(text);
    }
  }
  return out;
}

/**
 * Turn raw terminal log lines into UI timeline events:
 * - `>>> [n/m] Title` markers become phase separators
 * - tqdm progress redraws collapse into one live bar per phase
 * - "Starting X extraction ..." / "X extraction completed in Ns" pairs merge
 *   into a single task row (no split lines)
 * - everything else becomes a message, errors merge into blocks
 */
export function parseConsoleEvents(lines: string[], terminal = false): ConsoleEvent[] {
  const events: ConsoleEvent[] = [];
  const progressByPhase = new Map<string, ConsoleEvent>();
  let currentPhase = "";
  let scope = 0;
  let trainingHeartbeat = false;

  const pushProgress = (percent: number, detail: string, description = "") => {
    // tqdm lines inside an open extraction task feed that task's bar.
    const openTask = [...events].reverse().find((e) => e.kind === "task" && e.status === "running");
    if (openTask?.kind === "task") {
      openTask.percent = percent;
      openTask.detail = detail;
      return;
    }
    const phaseKey = `${scope}:${description}`;
    const existing = progressByPhase.get(phaseKey);
    if (existing && existing.kind === "progress") {
      existing.percent = percent;
      existing.detail = detail;
      return;
    }
    const ev: ConsoleEvent = {
      kind: "progress",
      key: `ev-progress-${phaseKey}`,
      phase: description || currentPhase,
      percent,
      detail,
    };
    progressByPhase.set(phaseKey, ev);
    events.push(ev);
  };

  for (const line of splitLogFragments(lines)) {
    const phase = line.match(PHASE_RE);
    if (phase) {
      scope++;
      trainingHeartbeat = false;
      for (const event of events) {
        if (event.kind === "task" && event.status === "running") event.status = "done";
      }
      currentPhase = phase[3].trim().replace(/\.*$/, "");
      events.push({
        kind: "phase",
        key: "",
        index: Number(phase[1]),
        total: Number(phase[2]),
        title: currentPhase,
      });
      continue;
    }

    const taskStart = line.match(TASK_START_RE);
    if (taskStart) {
      scope++;
      trainingHeartbeat = false;
      for (const event of events) {
        if (event.kind === "task" && event.status === "running") event.status = "done";
      }
      const name = taskStart[1].toLowerCase() === "pitch" ? "Pitch extraction" : "Embedding extraction";
      const meta = taskStart[2].replace(/^(on|with)\s+/i, "").trim();
      events.push({
        kind: "task",
        key: "",
        title: name,
        meta,
        status: "running",
        percent: null,
        detail: "",
        duration: null,
      });
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
          key: "",
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

    const tqdm = parseLogProgress(line);
    const heartbeat = parseTrainingProgress(line);
    if (heartbeat) {
      trainingHeartbeat = true;
      const done = heartbeat.current;
      const total = heartbeat.total;
      const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
      const detail = tqdm?.detail || `batch ${done}/${total}`;
      pushProgress(percent, `epoch ${heartbeat.epoch} · ${detail}`);
      continue;
    }

    if (tqdm) {
      // Older engines emit counters on stdout and bars on stderr. Prefer the
      // counters when those streams arrive out of order.
      if (!trainingHeartbeat || tqdm.description) {
        pushProgress(tqdm.percent, tqdm.detail, tqdm.description);
      }
      continue;
    }

    const epochLine = line.match(EPOCH_RE);
    if (epochLine) {
      if (trainingHeartbeat) pushProgress(100, `epoch ${epochLine[2]}`);
      const lossValue = epochLine[6];
      events.push({
        kind: "epoch",
        key: "",
        model: epochLine[1].trim(),
        epoch: Number(epochLine[2]),
        step: Number(epochLine[3]),
        time: epochLine[4],
        speed: epochLine[5],
        loss:
          lossValue !== undefined
            ? { value: lossValue, epoch: Number(epochLine[7]), step: Number(epochLine[8]) }
            : null,
      });
      continue;
    }

    const saveLine = line.match(SAVE_RE);
    if (saveLine) {
      const fullPath = saveLine[1];
      const filename = fullPath.split(/[\\/]/).pop() || fullPath;
      events.push({
        kind: "save",
        key: "",
        filename,
        epoch: Number(saveLine[2]),
        step: saveLine[3] !== undefined ? Number(saveLine[3]) : null,
      });
      continue;
    }

    const last = events[events.length - 1];
    if (ERROR_RE.test(line) || (last?.kind === "error" && isContinuationOfError(line))) {
      const numbered = { key: "", text: line };
      if (last?.kind === "error") last.lines.push(numbered);
      else events.push({ kind: "error", key: "", lines: [numbered] });
      continue;
    }

    events.push({ kind: "message", key: "", text: line, tone: messageTone(line) });
  }

  // Assign keys before moving live state. Phase changes must not remount rows
  // when the previous bar returns to its chronological position.
  events.forEach((ev, i) => {
    if (!ev.key) ev.key = `ev-${i}`;
    if (ev.kind === "error") {
      ev.lines.forEach((line, j) => {
        line.key = `${ev.key}-l${j}`;
      });
    }
  });

  // Keep only the current phase's bars and open tasks at the bottom so new
  // messages cannot scroll them away. Earlier phases remain in the history.
  const activeBars = new Set(
    [...progressByPhase.entries()].filter(([key]) => key.startsWith(`${scope}:`)).map(([, event]) => event),
  );
  const rows: ConsoleEvent[] = [];
  const bars: ConsoleEvent[] = [];
  for (const ev of events) {
    (activeBars.has(ev) || (ev.kind === "task" && ev.status === "running") ? bars : rows).push(ev);
  }
  events.length = 0;
  events.push(...rows, ...bars);

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
    case "epoch":
      return `${ev.model} epoch ${ev.epoch} step ${ev.step} ${ev.time} ${ev.speed} ${ev.loss ? `loss ${ev.loss.value}` : ""}`;
    case "save":
      return `saved ${ev.filename} checkpoint epoch ${ev.epoch} ${ev.step ?? ""}`;
    case "message":
      return ev.text;
    case "error":
      return ev.lines.map((l) => l.text).join("\n");
  }
}
