"use client";

import { Ghost, Gift, type LucideIcon, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { applyTheme, type ThemeFile } from "@/lib/theme";

interface Season {
  id: string;
  file: string;
  monthIndex: number;
  icon: LucideIcon;
  titleKey: string;
  bodyKey: string;
  dismissKey: string;
  ctaKey: string;
  errorKey: string;
  panelClass: string;
  iconClass: string;
  textClass: string;
  dismissIconClass: string;
  ctaClass: string;
}

const SEASONS: Season[] = [
  {
    id: "halloween",
    file: "halloween.json",
    monthIndex: 9,
    icon: Ghost,
    titleKey: "A little Halloween magic",
    bodyKey: "Pumpkin orange, midnight purple. Give Applio a seasonal glow.",
    dismissKey: "Dismiss Halloween invitation",
    ctaKey: "Enable Halloween theme",
    errorKey: "Could not enable Halloween theme. Please try again.",
    panelClass: "halloween-prompt",
    iconClass: "text-[#ffd2a8]",
    textClass: "text-[#eadbf6]",
    dismissIconClass: "text-[#eadbf6]",
    ctaClass: "!bg-[#ff9b42] !text-[#160b21] !border-transparent",
  },
  {
    id: "christmas",
    file: "christmas.json",
    monthIndex: 11,
    icon: Gift,
    titleKey: "A little Christmas magic",
    bodyKey: "Pine green, cranberry red. Give Applio a seasonal glow.",
    dismissKey: "Dismiss Christmas invitation",
    ctaKey: "Enable Christmas theme",
    errorKey: "Could not enable Christmas theme. Please try again.",
    panelClass: "xmas-prompt",
    iconClass: "text-[#ffe9a3]",
    textClass: "text-[#e8f4e0]",
    dismissIconClass: "text-[#e8f4e0]",
    ctaClass: "!bg-[#ffd166] !text-[#16241a] !border-transparent",
  },
];

export default function SeasonalThemePrompt() {
  const { t } = useI18n();
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const year = new Date().getFullYear();
  const season = SEASONS.find((s) => s.monthIndex === new Date().getMonth());
  const storageKey = season ? `applio:${season.id}-dismissed:${year}` : "";
  const dismissEvent = season ? `applio:${season.id}-dismissed` : "";

  useEffect(() => {
    if (!season) return;
    let live = true;
    let dismissed = false;
    try {
      if (localStorage.getItem(storageKey)) return;
    } catch {
      /* Storage is optional. */
    }
    apiGet<{ id: string }>("/api/settings/theme")
      .then((theme) => {
        if (live && !dismissed) setVisible(theme.id !== season.file);
      })
      .catch(() => {});
    const hide = () => {
      dismissed = true;
      setVisible(false);
    };
    window.addEventListener(dismissEvent, hide);
    const themeChanged = () => {
      apiGet<{ id: string }>("/api/settings/theme", { force: true })
        .then((theme) => {
          if (live && theme.id === season.file) hide();
        })
        .catch(() => {});
    };
    window.addEventListener("applio:theme-changed", themeChanged);
    return () => {
      live = false;
      window.removeEventListener(dismissEvent, hide);
      window.removeEventListener("applio:theme-changed", themeChanged);
    };
  }, [storageKey, dismissEvent, season]);

  function dismiss() {
    if (!season) return;
    if (panel.current?.contains(document.activeElement)) {
      panel.current.parentElement?.querySelector<HTMLAnchorElement>('a[href="/settings"]')?.focus();
    }
    try {
      localStorage.setItem(storageKey, "true");
    } catch {
      /* Keep dismissal for this session. */
    }
    window.dispatchEvent(new Event(dismissEvent));
    setVisible(false);
  }

  if (!visible || !season) return null;
  const Icon = season.icon;

  return (
    <section
      ref={panel}
      aria-labelledby={titleId}
      className={`${season.panelClass} shrink-0 mx-1 mt-2 rounded-xl p-2.5 space-y-1.5`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1.5 min-w-0 ${season.iconClass}`}>
          <Icon size={14} className="shrink-0" aria-hidden="true" />
          <h2 id={titleId} className="m-0 text-[11px] leading-snug font-semibold">
            {t(season.titleKey)}
          </h2>
        </span>
        <IconButton
          icon={<X size={13} />}
          label={t(season.dismissKey)}
          disabled={busy}
          onClick={dismiss}
          className={`!h-7 !w-7 !min-w-7 !min-h-7 !max-w-7 !max-h-7 !bg-transparent !border-transparent ${season.dismissIconClass}`}
        />
      </div>
      <p className={`m-0 text-[11px] leading-snug ${season.textClass}`}>{t(season.bodyKey)}</p>
      <Button
        size="xs"
        block
        loading={busy}
        className={`${season.ctaClass} !h-auto !min-h-8 !py-1 !px-2.5 !text-[11px] !leading-snug`}
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            const result = await apiGet<{ theme: ThemeFile }>(`/api/settings/theme?file=${season.file}`, {
              force: true,
            });
            if (!result.theme) throw new Error("Theme unavailable");
            await apiSend("/api/settings", "PUT", { theme: { file: season.file } });
            applyTheme(result.theme, season.file);
            window.dispatchEvent(new CustomEvent("applio:theme-changed", { detail: { file: season.file } }));
            dismiss();
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t(season.ctaKey)}
      </Button>
      {error && (
        <p role="alert" className="m-0 text-[11px] text-[#ffc9c9]">
          {t(season.errorKey)}
        </p>
      )}
    </section>
  );
}
