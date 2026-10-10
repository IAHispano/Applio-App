"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

export type ToastKind = "info" | "success" | "error";
export interface ToastAction {
  label: string;
  href?: string;
  onClick?: () => void;
}
export interface ToastOptions {
  id?: string;
  title?: string;
  duration?: number;
  action?: ToastAction;
  secondaryAction?: ToastAction;
}
interface Toast extends ToastOptions {
  id: string;
  kind: ToastKind;
  text: string;
}
let nextId = 1;

export function toast(text: string, kind: ToastKind = "info", options: ToastOptions = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("applio:toast", {
      detail: { ...options, text, kind, id: options.id || `toast-${nextId++}` },
    }),
  );
}

export default function Toaster() {
  const { t } = useI18n();
  const [items, setItems] = useState<Toast[]>([]);
  const timers = useRef(
    new Map<string, { handle?: ReturnType<typeof setTimeout>; remaining: number; deadline: number }>(),
  );
  const paused = useRef(new Set<string>());
  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current.get(id)?.handle);
    timers.current.delete(id);
    paused.current.delete(id);
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);
  const resume = (id: string) => {
    paused.current.delete(id);
    const timer = timers.current.get(id);
    if (!timer || timer.handle) return;
    timer.deadline = Date.now() + timer.remaining;
    timer.handle = setTimeout(() => dismiss(id), timer.remaining);
  };
  const pause = (id: string) => {
    paused.current.add(id);
    const timer = timers.current.get(id);
    if (!timer?.handle) return;
    clearTimeout(timer.handle);
    timer.handle = undefined;
    timer.remaining = Math.max(0, timer.deadline - Date.now());
  };
  useEffect(() => {
    const timerMap = timers.current;
    const onToast = (event: Event) => {
      const item = (event as CustomEvent<Toast>).detail;
      if (!item || typeof item.text !== "string" || !item.text.trim()) return;
      const duration = Math.max(1000, item.duration ?? (item.kind === "error" ? 12000 : 6500));
      clearTimeout(timerMap.get(item.id)?.handle);
      timerMap.set(item.id, {
        remaining: duration,
        deadline: Date.now() + duration,
        handle: paused.current.has(item.id) ? undefined : setTimeout(() => dismiss(item.id), duration),
      });
      setItems((prev) => {
        const next = [...prev.filter((old) => old.id !== item.id), item];
        const removed = next.splice(0, Math.max(0, next.length - 3));
        for (const old of removed) {
          clearTimeout(timerMap.get(old.id)?.handle);
          timerMap.delete(old.id);
          paused.current.delete(old.id);
        }
        return next;
      });
    };
    window.addEventListener("applio:toast", onToast);
    return () => {
      window.removeEventListener("applio:toast", onToast);
      for (const timer of timerMap.values()) clearTimeout(timer.handle);
      timerMap.clear();
    };
  }, [dismiss]);
  const action = (item: Toast, value: ToastAction) => {
    const className =
      "inline-flex rounded text-xs font-medium underline underline-offset-4 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4";
    const clicked = () => {
      value.onClick?.();
      dismiss(item.id);
    };
    if (value.href?.startsWith("/"))
      return (
        <Link href={value.href} onClick={clicked} className={className}>
          {value.label}
        </Link>
      );
    if (value.href)
      return (
        <a
          href={value.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={clicked}
          className={className}
        >
          {value.label}
        </a>
      );
    return (
      <button type="button" onClick={clicked} className={className}>
        {value.label}
      </button>
    );
  };
  if (!items.length) return null;
  return (
    <section
      aria-label={t("Notifications")}
      className="fixed right-4 left-4 sm:left-auto bottom-[calc(6rem+env(safe-area-inset-bottom))] lg:bottom-4 z-50 flex flex-col gap-2 pointer-events-none w-auto sm:w-96 max-w-[calc(100vw-2rem)]"
    >
      {items.map((item) => {
        const isError = item.kind === "error";
        const Icon = isError ? AlertCircle : item.kind === "success" ? CheckCircle2 : Info;
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: Hover and focus only pause dismissal; nested links and buttons provide interaction.
          <div
            key={item.id}
            role={isError ? "alert" : "status"}
            aria-live={isError ? "assertive" : "polite"}
            aria-atomic="true"
            onMouseEnter={() => pause(item.id)}
            onMouseLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement)) resume(item.id);
            }}
            onFocus={() => pause(item.id)}
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget) &&
                !event.currentTarget.matches(":hover")
              )
                resume(item.id);
            }}
            className={`toast-item pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-xl text-xs ${isError ? "bg-[var(--panel)] border-red-500/50 text-red-300" : "bg-[var(--panel)] border-[var(--border)] text-[var(--text)]"}`}
          >
            <Icon
              size={17}
              aria-hidden="true"
              className={`shrink-0 mt-0.5 ${item.kind === "success" ? "text-emerald-400" : ""}`}
            />
            <div className="flex-1 min-w-0 space-y-2">
              {item.title && <p className="m-0 font-semibold leading-relaxed">{item.title}</p>}
              <p className="m-0 leading-relaxed break-words whitespace-pre-line max-h-32 overflow-y-auto">
                {item.text}
              </p>
              {(item.action || item.secondaryAction) && (
                <div className="flex flex-wrap gap-4 pt-1">
                  {item.action && action(item, item.action)}
                  {item.secondaryAction && action(item, item.secondaryAction)}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label={t("Dismiss notification")}
              className="shrink-0 -mr-1 -mt-1 p-2 rounded-md text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface)] focus-visible:outline focus-visible:outline-2"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </section>
  );
}
