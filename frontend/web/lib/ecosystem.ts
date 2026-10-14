import ecosystem from "../../../assets/ecosystem.json";

export const ECOSYSTEM = ecosystem;
export const DOCS_URL = ecosystem.links.docs;
export const WEBSITE_URL = ecosystem.links.website;

export function guideUrl(guide: keyof typeof ecosystem.guides): string {
  return new URL(ecosystem.guides[guide], DOCS_URL).href;
}

const PAGE_GUIDES: Record<string, keyof typeof ecosystem.guides> = {
  "/": "desktop",
  "/setup": "installation",
  "/inference": "inference",
  "/tts": "tts",
  "/models": "models",
  "/train": "training",
  "/voice-blender": "blender",
  "/realtime": "realtime",
  "/extra": "audio",
  "/audio-separator": "separation",
  "/tensorboard": "tensorboard",
  "/jobs": "jobs",
  "/settings": "storage",
  "/report": "report",
};

export function guideForPage(pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  const route = pathname.replace(/\/+$/, "") || "/";
  const guide = PAGE_GUIDES[route.startsWith("/jobs/") ? "/jobs" : route];
  return guide ? guideUrl(guide) : undefined;
}
