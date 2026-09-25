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
  /** Whether to render a bottom border separating header from content (default: true) */
  border?: boolean;
  /** Extra CSS classes for the header container */
  className?: string;
}

function CardHeaderInner({
  icon,
  title,
  description,
  step,
  action,
  border = true,
  className = "",
}: CardHeaderProps) {
  return (
    <div className={`${border ? "border-b border-white/10 pb-3.5" : ""} space-y-1 ${className}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {step !== undefined && (
            <>
              <span className="sr-only">Step {step}: </span>
              <span
                className="w-5 h-5 rounded-full bg-white/10 text-xs font-bold text-white flex items-center justify-center shrink-0"
                aria-hidden="true"
              >
                {step}
              </span>
            </>
          )}
          {icon && (
            <span className="text-white shrink-0 flex items-center" aria-hidden="true">
              {icon}
            </span>
          )}
          {typeof title === "string" ? (
            <h2 className="text-base font-bold text-white m-0 truncate">{title}</h2>
          ) : (
            title
          )}
        </div>
        {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
      </div>
      {description && <p className="text-xs text-neutral-400 m-0 leading-relaxed">{description}</p>}
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
