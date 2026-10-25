export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function playerClasses(compact: boolean) {
  return {
    btnSquare: compact
      ? "audioplayer-btn h-8 w-8 !p-0 rounded-xl"
      : "audioplayer-btn h-9 w-9 !p-0 rounded-xl",
    btnText: compact
      ? "audioplayer-btn-text h-8 px-2.5 rounded-xl"
      : "audioplayer-btn-text h-9 px-3 rounded-xl",
    pillContainer: compact ? "h-8 rounded-xl" : "h-9 rounded-xl",
  };
}
