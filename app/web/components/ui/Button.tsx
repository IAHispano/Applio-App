"use client";

import type React from "react";
import { forwardRef, memo } from "react";

export type ButtonVariant = "primary" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  /** Visual style variant */
  variant?: ButtonVariant;
  /** Size preset: xs = h-7, sm = h-8, md = h-9, lg = h-10 */
  size?: ButtonSize;
  /** Click handler (works for both `<button>` and `<a>` rendering) */
  onClick?: React.MouseEventHandler<HTMLElement>;
  /** Optional icon placed before children */
  icon?: React.ReactNode;
  /** Optional icon placed after children */
  iconAfter?: React.ReactNode;
  /** Loading state — disables and shows a spinner */
  loading?: boolean;
  /** Render as a full-width block button */
  block?: boolean;
  /** When set, renders an `<a>` instead of `<button>` (e.g. download links) */
  href?: string;
  /** Anchor download attribute (only applies with `href`) */
  download?: string | boolean;
  /** Anchor target attribute (only applies with `href`) */
  target?: React.HTMLAttributeAnchorTarget;
  /** Anchor rel attribute (defaults to "noreferrer" for target="_blank") */
  rel?: string;
}

const sizeClasses: Record<ButtonSize, string> = {
  xs: "h-7 px-2.5 text-xs rounded-lg gap-1.5",
  sm: "h-8 px-3 text-xs rounded-lg gap-1.5",
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
      href,
      download,
      target,
      rel,
      type = "button",
      onClick,
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;
    const base =
      "flex items-center justify-center cursor-pointer select-none transition-colors shrink-0 whitespace-nowrap no-underline max-w-full";
    const classes = [
      base,
      variantClasses[variant],
      sizeClasses[size],
      block ? "w-full" : "",
      isDisabled ? "opacity-50 cursor-not-allowed" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    const content = (
      <>
        {loading ? (
          <>
            <span
              className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0"
              aria-hidden="true"
            />
            <span className="sr-only">Loading...</span>
          </>
        ) : icon ? (
          <span className="shrink-0 flex items-center" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {children && <span className="truncate min-w-0">{children}</span>}
        {iconAfter && (
          <span className="shrink-0 flex items-center" aria-hidden="true">
            {iconAfter}
          </span>
        )}
      </>
    );

    if (href !== undefined) {
      return (
        <a
          ref={ref as unknown as React.Ref<HTMLAnchorElement>}
          href={isDisabled ? undefined : href}
          download={download}
          target={target}
          rel={rel ?? (target === "_blank" ? "noreferrer" : undefined)}
          aria-disabled={isDisabled || undefined}
          aria-busy={loading || undefined}
          onClick={isDisabled ? (e) => e.preventDefault() : onClick}
          className={classes}
        >
          {content}
        </a>
      );
    }

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        onClick={onClick}
        className={classes}
        {...rest}
      >
        {content}
      </button>
    );
  },
);

Button.displayName = "Button";

const MemoizedButton = memo(Button) as typeof Button;
export default MemoizedButton;
