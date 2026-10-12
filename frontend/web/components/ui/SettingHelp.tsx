import type { ReactNode } from "react";

/** Visible setting guidance, linked to its control for assistive technology. */
export default function SettingHelp({ text, controlId }: { text: ReactNode; controlId?: string }) {
  return text ? (
    <p id={controlId ? `${controlId}-help` : undefined} className="field-help mt-2 mb-0 min-w-0">
      {text}
    </p>
  ) : null;
}
