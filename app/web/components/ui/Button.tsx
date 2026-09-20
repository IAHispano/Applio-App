"use client";

import type React from "react";
import { forwardRef } from "react";

export type ButtonVariant = "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style variant */
  variant?: ButtonVariant;
  /** Size preset */
  size?: ButtonSize;
  /** Optional icon placed before children */
  icon?: React.ReactNode;
  /** Optional icon placed after children */
  iconAfter?: React.ReactNode;
  /** Loading state — disables and shows a spinner */
  loading?: boolean;
  /** Render as a full-width block button */
  block?: boolean;
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs rounded-lg gap-1.5",
  md: "h-9 px-4 text-xs rounded-xl gap-2",
  lg: "h-10 px-5 text-sm rounded-xl gap-2",
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "cta font-medium",
  ghost: "ghost font-medium text-neutral-200 hover:text-white",
  danger: "ghost font-medium text-red-400 hover:text-red-300 border-red-500/30",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "lg",
      icon,
      iconAfter,
      loading = false,
      block = false,
      disabled,
      className = "",
      children,
      ...rest
    },
    ref,
  ) => {
    const base = "flex items-center justify-center cursor-pointer select-none transition-colors shrink-0";
    const classes = [
      base,
      variantClasses[variant],
      sizeClasses[size],
      block ? "w-full" : "",
      disabled || loading ? "opacity-50 cursor-not-allowed" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button ref={ref} type="button" disabled={disabled || loading} className={classes} {...rest}>
        {loading ? (
          <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
        ) : icon ? (
          <span className="shrink-0">{icon}</span>
        ) : null}
        {children && <span>{children}</span>}
        {iconAfter && <span className="shrink-0">{iconAfter}</span>}
      </button>
    );
  },
);

Button.displayName = "Button";

export default Button;
