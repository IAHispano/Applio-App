// Shown while a route chunk or view is loading, matching the Applio app style.
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="h-full w-full min-h-[260px] flex flex-col items-center justify-center select-none p-6"
    >
      <div className="flex flex-col gap-3.5 p-5 rounded-2xl bg-[var(--panel)] border border-[var(--border)] max-w-xs w-full shadow-lg">
        <div className="flex items-center justify-between">
          <span className="text-base font-semibold tracking-tight text-[var(--heading)]">Applio</span>
          <span className="text-xs text-[var(--muted)] animate-pulse">Loading…</span>
        </div>

        <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden relative">
          <div className="loaderBar" />
        </div>
      </div>
    </div>
  );
}
