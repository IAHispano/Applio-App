export function formatTime(seconds: number, showTenths = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = String(Math.floor(seconds % 60)).padStart(2, "0");
  const tenths = showTenths ? `.${Math.floor(seconds * 10) % 10}` : "";
  return `${minutes}:${remainder}${tenths}`;
}
