import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="h-full w-full min-h-[160px] flex items-center justify-center p-6 text-neutral-400 select-none"
    >
      <Loader2 className="w-6 h-6 animate-spin text-white/50" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
