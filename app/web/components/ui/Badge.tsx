"use client";

import type React from "react";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info" | "outline";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Visual style variant */
  variant?: BadgeVariant;
  /** Size scale (default: "sm") */
  size?: "sm" | "md";
  /** Optional animated or solid colored dot prefix */
  dot?: boolean;
  /** Badge content */
  children: React.ReactNode;
  /** Extra CSS classes */
  className?: string;
}

const variantStyles: Record<BadgeVariant, { badge: string; dot: string }> = {
  neutral: {
    badge: "bg-white/10 text-neutral-300 border-white/10",
    dot: "bg-neutral-400",
  },
  success: {
    badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    dot: "bg-emerald-400",
  },
  warning: {
    badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    dot: "bg-amber-400",
  },
  danger: {
    badge: "bg-red-500/15 text-red-400 border-red-500/30",
    dot: "bg-red-400",
  },
  info: {
    badge: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    dot: "bg-sky-400",
  },
  outline: {
    badge: "bg-transparent text-neutral-400 border-white/15",
    dot: "bg-neutral-400",
  },
};

export default function Badge({
  variant = "neutral",
  size = "sm",
  dot = false,
  children,
  className = "",
  ...props
}: BadgeProps) {
  const styles = variantStyles[variant];
  const sizeClasses = size === "sm" ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-1";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap select-none ${styles.badge} ${sizeClasses} ${className}`}
      {...props}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${styles.dot}`} aria-hidden="true" />}
      <span>{children}</span>
    </span>
  );
}
