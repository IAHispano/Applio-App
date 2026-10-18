"use client";

import { Ghost, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { applyTheme, type ThemeFile } from "@/lib/theme";

const DISMISS_EVENT = "applio:halloween-dismissed";

export default function HalloweenThemePrompt() {
  const { t } = useI18n();
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const year = new Date().getFullYear();
  const storageKey = `applio:halloween-dismissed:${year}`;

  useEffect(() => {
    if (new Date().getMonth() !== 9) return;
    let live = true;
    let dismissed = false;
    try {
      if (localStorage.getItem(storageKey)) return;
    } catch {
      /* Storage is optional. */
    }
    apiGet<{ id: string }>("/api/settings/theme")
      .then((theme) => {
        if (live && !dismissed) setVisible(theme.id !== "halloween.json");
      })
      .catch(() => {});
    const hide = () => {
      dismissed = true;
      setVisible(false);
    };
    window.addEventListener(DISMISS_EVENT, hide);
    const themeChanged = () => {
      apiGet<{ id: string }>("/api/settings/theme", { force: true })
        .then((theme) => {
          if (live && theme.id === "halloween.json") hide();
        })
        .catch(() => {});
    };
    window.addEventListener("applio:theme-changed", themeChanged);
    return () => {
      live = false;
      window.removeEventListener(DISMISS_EVENT, hide);
      window.removeEventListener("applio:theme-changed", themeChanged);
    };
  }, [storageKey]);

  function dismiss() {
    if (panel.current?.contains(document.activeElement)) {
      panel.current.parentElement?.querySelector<HTMLAnchorElement>('a[href="/settings"]')?.focus();
    }
    try {
      localStorage.setItem(storageKey, "true");
    } catch {
      /* Keep dismissal for this session. */
    }
    window.dispatchEvent(new Event(DISMISS_EVENT));
    setVisible(false);
  }

  if (!visible) return null;
  return (
    <section
      ref={panel}
      aria-labelledby={titleId}
      className="halloween-prompt shrink-0 mx-1 mt-2 rounded-xl p-2.5 space-y-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0 text-[#ffd2a8]">
          <Ghost size={14} className="shrink-0" aria-hidden="true" />
          <h2 id={titleId} className="m-0 text-[11px] leading-snug font-semibold">
            {t("A little Halloween magic")}
          </h2>
        </span>
        <IconButton
          icon={<X size={13} />}
          label={t("Dismiss Halloween invitation")}
          disabled={busy}
          onClick={dismiss}
          className="!h-7 !w-7 !min-w-7 !min-h-7 !max-w-7 !max-h-7 !bg-transparent !border-transparent !text-[#eadbf6]"
        />
      </div>
      <p className="m-0 text-[11px] leading-snug text-[#eadbf6]">
        {t("Pumpkin orange, midnight purple. Give Applio a seasonal glow.")}
      </p>
      <Button
        size="xs"
        block
        loading={busy}
        className="!bg-[#ff9b42] !text-[#160b21] !border-transparent !h-auto !min-h-8 !py-1 !px-2.5 !text-[11px] !leading-snug"
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            const result = await apiGet<{ theme: ThemeFile }>("/api/settings/theme?file=halloween.json", {
              force: true,
            });
            if (!result.theme) throw new Error("Theme unavailable");
            await apiSend("/api/settings", "PUT", { theme: { file: "halloween.json" } });
            applyTheme(result.theme, "halloween.json");
            window.dispatchEvent(
              new CustomEvent("applio:theme-changed", { detail: { file: "halloween.json" } }),
            );
            dismiss();
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Enable Halloween theme")}
      </Button>
      {error && (
        <p role="alert" className="m-0 text-[11px] text-[#ffc9c9]">
          {t("Could not enable Halloween theme. Please try again.")}
        </p>
      )}
    </section>
  );
}
