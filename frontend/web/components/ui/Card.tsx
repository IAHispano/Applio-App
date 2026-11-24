"use client";

import type React from "react";
import { memo } from "react";
import { useI18n } from "@/lib/i18n";

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
  /** Extra CSS classes for the header container */
  className?: string;
}

function CardHeaderInner({ icon, title, description, step, action, className = "" }: CardHeaderProps) {
  const { t } = useI18n();
  const stepLabel = step !== undefined && <span className="sr-only">{t("Step {step}", { step })}. </span>;
  return (
    <header className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-3 ${className}`}>
      <div className="flex min-w-0 items-start gap-2.5 flex-[1_1_12rem]">
        {(step !== undefined || icon) && (
          <span className="card-heading-mark" aria-hidden="true">
            {step ?? icon}
          </span>
        )}
        <div className="min-w-0 min-h-[30px] flex flex-col justify-center gap-1">
          {typeof title === "string" ? (
            <h2 className="card-heading m-0 wrap-anywhere">
              {stepLabel}
              {title}
            </h2>
          ) : (
            <>
              {stepLabel}
              {title}
            </>
          )}
          {description && <p className="field-help m-0 max-w-3xl">{description}</p>}
        </div>
      </div>
      {action && <div className="flex min-w-0 max-w-full items-center gap-2 flex-wrap">{action}</div>}
    </header>
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
