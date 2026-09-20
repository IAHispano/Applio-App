"use client";

import { Loader2 } from "lucide-react";
import type React from "react";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon element to render inside the button */
  icon: React.ReactNode;
  /** Accessible label used for aria-label and browser tooltip */
  label: string;
  /** Visual variant (default: "ghost") */
  variant?: "ghost" | "default" | "danger";
  /** Size variant: "sm" is 28x28px (h-7 w-7), "md" is 32x32px (h-8 w-8) */
  size?: "sm" | "md";
  /** Whether to render a spinning loader instead of the icon */
  loading?: boolean;
}

export default function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "sm",
  loading = false,
  disabled = false,
  className = "",
  type = "button",
  ...props
}: IconButtonProps) {
  const variantClass =
    variant === "danger"
      ? "danger border-red-500/30 text-red-400 hover:text-red-300"
      : variant === "default"
        ? ""
        : "ghost text-neutral-300 hover:text-white";

  const sizeClass = size === "md" ? "h-8 w-8 !min-w-8 !min-h-8" : "h-7 w-7";

  return (
    <button
      type={type}
      disabled={disabled || loading}
      title={label}
      aria-label={label}
      className={`icon-btn rounded-lg ${variantClass} ${sizeClass} ${className}`}
      style={{ padding: 0 }}
      {...props}
    >
      {loading ? <Loader2 size={size === "md" ? 16 : 14} className="animate-spin shrink-0" /> : icon}
    </button>
  );
}
