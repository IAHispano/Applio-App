"use client";

import type React from "react";
import { forwardRef, memo } from "react";
import Link from "@/components/layout/IntentLink";
import { useI18n } from "@/lib/i18n";

export type ButtonVariant = "primary" | "ghost" | "danger";

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  /** Visual style variant */
  variant?: ButtonVariant;
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

const variantClasses: Record<ButtonVariant, string> = {
  primary: "cta",
  ghost: "ghost",
  danger: "danger",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
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
      title,
      type = "button",
      onClick,
      ...rest
    },
    ref,
  ) => {
    const { t } = useI18n();
    const isDisabled = disabled || loading;
    const hasLabel = children != null && typeof children !== "boolean" && children !== "";
    const tooltip = title ?? (typeof children === "string" ? children : undefined);
    const base =
      "app-button inline-flex items-center justify-center cursor-pointer select-none transition-colors min-w-0 no-underline max-w-full";
    const classes = [
      base,
      variantClasses[variant],
      !hasLabel && (icon || iconAfter || loading) ? "app-button-icon-only" : "",
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
            <span className="sr-only">{t("Loading...")}</span>
          </>
        ) : icon ? (
          <span className="app-button-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {hasLabel && <span className="action-label">{children}</span>}
        {iconAfter && (
          <span className="app-button-icon" aria-hidden="true">
            {iconAfter}
          </span>
        )}
      </>
    );

    if (href !== undefined) {
      if (
        href.startsWith("/") &&
        !href.startsWith("//") &&
        !/^\/(api|bridge)(\/|$)/.test(href) &&
        !download &&
        !target
      ) {
        return (
          <Link
            ref={ref as unknown as React.Ref<HTMLAnchorElement>}
            href={href}
            aria-disabled={isDisabled || undefined}
            aria-busy={loading || undefined}
            tabIndex={isDisabled ? -1 : undefined}
            onClick={isDisabled ? (event) => event.preventDefault() : onClick}
            className={classes}
            title={tooltip}
            aria-label={rest["aria-label"]}
            aria-describedby={rest["aria-describedby"]}
          >
            {content}
          </Link>
        );
      }
      return (
        <a
          ref={ref as unknown as React.Ref<HTMLAnchorElement>}
          href={isDisabled ? undefined : href}
          download={download}
          target={target}
          rel={rel ?? (target === "_blank" ? "noreferrer" : undefined)}
          aria-disabled={isDisabled || undefined}
          aria-busy={loading || undefined}
          onClick={(e) => {
            if (isDisabled) {
              e.preventDefault();
              return;
            }
            onClick?.(e);
          }}
          className={classes}
          title={tooltip}
          aria-label={rest["aria-label"]}
          aria-describedby={rest["aria-describedby"]}
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
        title={tooltip}
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
