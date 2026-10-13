"use client";

import { Check, Download } from "lucide-react";
import { parseSetupLine } from "@/lib/setup-logs";

/** One nicely formatted activity-log row. Returns null for hidden noise lines. */
export default function SetupLogLine({ text }: { text: string }) {
  const parsed = parseSetupLine(text);
  switch (parsed.kind) {
    case "hide":
      return null;
    case "command":
      return (
        <div
          className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 font-mono text-[11px] leading-relaxed"
          title={parsed.raw}
        >
          <span className="select-none font-bold text-neutral-500">$</span>
          <span className="min-w-0 flex-1 break-all text-neutral-200">{parsed.pretty}</span>
        </div>
      );
    case "stage":
      return (
        <div className="mt-2 flex items-start gap-1.5 font-semibold text-white first:mt-0">
          <span className="select-none text-neutral-500">›</span>
          <span className="min-w-0 flex-1 break-all">{parsed.pretty}</span>
        </div>
      );
    case "download": {
      const dl = parsed.download;
      return (
        <div className="flex items-center gap-1.5 py-0.5" title={parsed.raw}>
          <Download
            size={11}
            className={dl?.done ? "shrink-0 text-emerald-400" : "shrink-0 text-neutral-500"}
          />
          <span className="min-w-0 flex-1 truncate text-neutral-300">{dl?.pkg ?? parsed.pretty}</span>
          {dl?.size && (
            <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-neutral-400">
              {dl.size}
            </span>
          )}
          {dl?.done && <Check size={11} className="shrink-0 text-emerald-400" />}
        </div>
      );
    }
    case "success":
      return (
        <div className="flex items-start gap-1.5 py-0.5 font-medium text-emerald-400">
          <span className="select-none font-bold">✓</span>
          <span className="min-w-0 flex-1 break-all text-neutral-200">{parsed.pretty}</span>
        </div>
      );
    case "error":
      return (
        <div className="flex items-start gap-1.5 py-0.5 font-medium text-red-400">
          <span className="select-none font-bold">✗</span>
          <span className="min-w-0 flex-1 break-all text-red-300">
            {parsed.pretty.replace(/^(✗|\[ERR\])\s*/, "")}
          </span>
        </div>
      );
    case "warning":
      return (
        <div className="flex items-start gap-1.5 py-0.5 text-amber-400">
          <span className="select-none font-bold">!</span>
          <span className="min-w-0 flex-1 break-all text-amber-200/90">
            {parsed.pretty.replace(/^(\[!\]|!)\s*/, "")}
          </span>
        </div>
      );
    case "info":
      return (
        <div
          className="mt-0.5 flex items-start gap-1.5 rounded-md bg-white/[0.03] px-2 py-1"
          title={parsed.raw}
        >
          <span className="select-none text-neutral-500">▸</span>
          <span className="min-w-0 flex-1 break-all text-neutral-200">{parsed.pretty}</span>
        </div>
      );
    case "muted":
      return (
        <div className="flex items-start gap-1.5 py-px text-[11px]">
          <span className="select-none text-neutral-700">·</span>
          <span className="min-w-0 flex-1 truncate text-neutral-500" title={parsed.raw}>
            {parsed.pretty}
          </span>
        </div>
      );
    default:
      return (
        <div className="flex items-start gap-1.5 py-0.5">
          <span className="select-none text-neutral-600">•</span>
          <span className="min-w-0 flex-1 break-all text-neutral-300">{parsed.pretty}</span>
        </div>
      );
  }
}
