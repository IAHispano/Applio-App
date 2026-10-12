"use client";

import type React from "react";
import { memo } from "react";

export interface CardHeaderProps {
  /** Optional icon displayed before the title */
  icon?: React.ReactNode;
  /** Primary card heading */
  title: React.ReactNode;
  /** Optional subtitle or descriptive text */
  description?: React.ReactNode;
  /** Optional numbered workflow step badge (e.g., 1, 2, 3) */
  step?: number | string;
  /** Optional action slot aligned to the right (button, badge, controls) */
  action?: React.ReactNode;
  /** Retained for existing callers; headers now use the card's spacing instead of a divider. */
  border?: boolean;
  /** Extra CSS classes for the header container */
  className?: string;
}

function CardHeaderInner({ icon, title, description, step, action, className = "" }: CardHeaderProps) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-wrap sm:flex-nowrap">
          {step !== undefined && (
            <>
              <span className="sr-only">Step {step}: </span>
              <span
                className="w-6 h-6 rounded-lg bg-[var(--accent-soft)] text-[11px] font-semibold tabular-nums leading-none text-[var(--accent)] flex items-center justify-center shrink-0"
                aria-hidden="true"
              >
                {step}
              </span>
            </>
          )}
          {icon && (
            <span className="text-[var(--muted)] shrink-0 flex items-center" aria-hidden="true">
              {icon}
            </span>
          )}
          {typeof title === "string" ? (
            <h2 className="text-xl font-bold text-[var(--heading)] m-0 break-words">{title}</h2>
          ) : (
            title
          )}
        </div>
        {action && <div className="flex items-center gap-2 flex-wrap sm:shrink-0">{action}</div>}
      </div>
      {description && <p className="field-help m-0 max-w-3xl">{description}</p>}
    </div>
  );
}

export const CardHeader = memo(CardHeaderInner);

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: "div" | "section" | "article";
  children: React.ReactNode;
  className?: string;
}

function CardInner({ as: Component = "div", children, className = "", ...props }: CardProps) {
  return (
    <Component className={`card space-y-4 ${className}`} {...props}>
      {children}
    </Component>
  );
}

export const Card = memo(CardInner);
export default Card;
