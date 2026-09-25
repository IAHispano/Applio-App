"use client";

import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import type React from "react";
import { memo } from "react";

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

function AlertInner({ variant = "error", title, children, icon, onDismiss, className = "" }: AlertProps) {
  const styles = variantStyles[variant];

  return (
    <div
      role="alert"
      aria-live={variant === "error" ? "assertive" : "polite"}
      className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 animate-in fade-in duration-200 ${styles.container} ${className}`}
    >
      <span className={`${styles.iconColor} shrink-0 mt-0.5`}>{icon ?? styles.defaultIcon}</span>
      <div className="flex-1 min-w-0 space-y-0.5">
        {title && <p className={`font-semibold m-0 ${styles.text}`}>{title}</p>}
        <div className="leading-relaxed break-words">{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-neutral-400 hover:text-white shrink-0 p-0.5 rounded transition-colors -mr-1 -mt-0.5"
          aria-label="Dismiss alert"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

const Alert = memo(AlertInner);
export default Alert;
