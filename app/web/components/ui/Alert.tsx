"use client";

import { AlertCircle, AlertTriangle, Check, CheckCircle2, ChevronDown, Copy, Info, X } from "lucide-react";
import type React from "react";
import { memo, useCallback, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";

export type AlertVariant = "error" | "warning" | "info" | "success";

export interface AlertProps {
  /** Visual severity variant (default: "error") */
  variant?: AlertVariant;
  /** Optional alert title / heading */
  title?: React.ReactNode;
  /** Alert message body */
  children: React.ReactNode;
  /** Optional custom icon override */
  icon?: React.ReactNode;
  /** Optional technical error details / logs to display in collapsible area */
  details?: React.ReactNode;
  /** Optional text to copy when clicking Copy button (defaults to details or message) */
  copyText?: string;
  /** Optional dismiss callback to show a close button */
  onDismiss?: () => void;
  /** Extra CSS classes */
  className?: string;
}

const variantStyles: Record<
  AlertVariant,
  { container: string; text: string; iconColor: string; defaultIcon: React.ReactNode }
> = {
  error: {
    container: "bg-red-500/10 border-red-500/30 text-red-300",
    text: "text-red-400",
    iconColor: "text-red-400",
    defaultIcon: <AlertCircle size={16} className="shrink-0" />,
  },
  warning: {
    container: "bg-amber-500/10 border-amber-500/30 text-amber-300",
    text: "text-amber-400",
    iconColor: "text-amber-400",
    defaultIcon: <AlertTriangle size={16} className="shrink-0" />,
  },
  info: {
    container: "bg-sky-500/10 border-sky-500/30 text-sky-300",
    text: "text-sky-400",
    iconColor: "text-sky-400",
    defaultIcon: <Info size={16} className="shrink-0" />,
  },
  success: {
    container: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
    text: "text-emerald-400",
    iconColor: "text-emerald-400",
    defaultIcon: <CheckCircle2 size={16} className="shrink-0" />,
  },
};

function AlertInner({
  variant = "error",
  title,
  children,
  icon,
  details,
  copyText,
  onDismiss,
  className = "",
}: AlertProps) {
  const { t } = useI18n();
  const styles = variantStyles[variant];
  const [copied, setCopied] = useState(false);

  // If children is a string with multiple lines or contains traceback/stderr,
  // and no details was passed, separate primary message from details.
  const isStringChildren = typeof children === "string";
  const shouldAutoExtractDetails =
    !details &&
    isStringChildren &&
    (children.includes("\n") ||
      children.includes("Traceback (most recent call last)") ||
      children.includes("[stderr]"));

  let displayChildren = children;
  let effectiveDetails = details;

  if (shouldAutoExtractDetails) {
    const rawLines = (children as string).split("\n");
    const firstNonEmpty = rawLines.findIndex((l) => l.trim().length > 0);
    if (firstNonEmpty >= 0 && rawLines.length > firstNonEmpty + 1) {
      displayChildren = rawLines[firstNonEmpty].trim();
      effectiveDetails = rawLines
        .slice(firstNonEmpty + 1)
        .join("\n")
        .trim();
    }
  }

  // Text to copy to clipboard
  const textToCopy = useMemo(() => {
    if (copyText) return copyText;
    const parts: string[] = [];
    if (typeof title === "string" && title) parts.push(title);
    if (typeof displayChildren === "string" && displayChildren) parts.push(displayChildren);
    if (typeof effectiveDetails === "string" && effectiveDetails) {
      parts.push(`\nDetails:\n${effectiveDetails}`);
    }
    return parts.join("\n").trim();
  }, [copyText, title, displayChildren, effectiveDetails]);

  const handleCopy = useCallback(() => {
    if (!textToCopy) return;
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }, [textToCopy]);

  const hasCopy = Boolean(textToCopy && (variant === "error" || effectiveDetails || copyText));

  return (
    <div
      role="alert"
      aria-live={variant === "error" ? "assertive" : "polite"}
      className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 animate-in fade-in duration-200 ${styles.container} ${className}`}
    >
      <span className={`${styles.iconColor} shrink-0 mt-0.5`}>{icon ?? styles.defaultIcon}</span>
      <div className="flex-1 min-w-0 space-y-1">
        {title && <p className={`font-semibold m-0 ${styles.text}`}>{title}</p>}
        <div className="leading-relaxed break-words whitespace-pre-wrap">{displayChildren}</div>
        {effectiveDetails && (
          <details className="mt-2 text-xs group pt-1 border-t border-white/10">
            <summary className="cursor-pointer hover:text-white transition-colors py-0.5 flex items-center gap-1.5 select-none font-medium text-[11px] text-neutral-400">
              <ChevronDown size={12} className="transition-transform group-open:rotate-180 shrink-0" />
              <span>{t("Technical Details & Logs")}</span>
            </summary>
            <div className="mt-1.5">
              {typeof effectiveDetails === "string" ? (
                <pre className="p-2.5 rounded-lg bg-black/60 border border-white/10 font-mono text-[11px] leading-relaxed max-h-52 overflow-y-auto whitespace-pre-wrap break-all select-text text-neutral-300">
                  {effectiveDetails}
                </pre>
              ) : (
                effectiveDetails
              )}
            </div>
          </details>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0 -mr-1 -mt-0.5">
        {hasCopy && (
          <button
            type="button"
            onClick={handleCopy}
            className="text-neutral-400 hover:text-white shrink-0 p-1 rounded hover:bg-white/5 transition-colors flex items-center gap-1 text-[11px]"
            aria-label={t("Copy error details to clipboard")}
            title={t("Copy error details to clipboard")}
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            <span className="text-[10px] hidden sm:inline">{copied ? t("Copied") : t("Copy")}</span>
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-neutral-400 hover:text-white shrink-0 p-1 rounded hover:bg-white/5 transition-colors"
            aria-label={t("Dismiss alert")}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

const Alert = memo(AlertInner);
export default Alert;
