import type { ReactNode } from "react";

/** Visible setting guidance, linked to its control for assistive technology. */
export default function SettingHelp({ text, controlId }: { text: ReactNode; controlId?: string }) {
  return text ? (
    <p
      id={controlId ? `${controlId}-help` : undefined}
      className="text-[11px] text-neutral-400 mt-1.5 mb-0 leading-relaxed min-w-0"
    >
      {text}
    </p>
  ) : null;
}
