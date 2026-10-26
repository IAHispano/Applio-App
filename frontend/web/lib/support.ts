import { ECOSYSTEM } from "@/lib/ecosystem";

export const SUPPORT_URL = ECOSYSTEM.links.support;
export const PATREON_URL = ECOSYSTEM.links.patreon;
export const DISCORD_SUPPORT_URL = ECOSYSTEM.links.discord;
const REMINDER_KEY = "applio:support-reminder";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function supportReminderDue(storage: Pick<Storage, "getItem" | "setItem">, now = Date.now()): boolean {
  try {
    const state = JSON.parse(storage.getItem(REMINDER_KEY) || "{}") as {
      disabled?: boolean;
      successes?: number;
      lastShown?: number;
    };
    if (state.disabled) return false;
    const successes = Math.min(3, (state.successes || 0) + 1);
    const due = successes >= 3 && (!state.lastShown || now - state.lastShown >= WEEK_MS);
    storage.setItem(
      REMINDER_KEY,
      JSON.stringify({ ...state, successes: due ? 0 : successes, lastShown: due ? now : state.lastShown }),
    );
    return due;
  } catch {
    return false;
  }
}
