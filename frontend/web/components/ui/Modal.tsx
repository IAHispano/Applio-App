"use client";

import { type ReactNode, useId } from "react";
import Dialog from "./Dialog";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl";
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  danger?: boolean;
  icon?: ReactNode;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  maxWidth,
  size = "md",
  danger = false,
  icon,
}: ModalProps) {
  const generatedId = useId();
  const titleId = `modal-title-${generatedId}`;
  const descId = `modal-desc-${generatedId}`;

  const widthClass = {
    sm: "max-w-md",
    md: "max-w-xl",
    lg: "max-w-3xl",
    xl: "max-w-4xl",
    "2xl": "max-w-5xl",
  }[maxWidth || size];

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className="app-modal fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-sm modal-backdrop"
    >
      <div
        className={`modal-panel w-full ${widthClass} max-h-[calc(100dvh-1.5rem)] overflow-y-auto overflow-x-hidden min-w-0 bg-[var(--panel)] text-[var(--text)] border ${
          danger ? "border-red-500/30 shadow-red-500/10" : "border-[var(--border)]"
        } rounded-2xl p-4 sm:p-6 shadow-2xl space-y-4 focus:outline-none`}
      >
        <div className="flex items-start justify-between gap-3 pb-2">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && (
              <span aria-hidden="true" className="shrink-0">
                {icon}
              </span>
            )}
            <div className="space-y-0.5 min-w-0">
              <h2 id={titleId} className="text-lg font-semibold text-[var(--heading)] tracking-tight m-0">
                {title}
              </h2>
              {description && (
                <p id={descId} className="text-xs text-[var(--muted)] leading-relaxed m-0">
                  {description}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Modal Content */}
        <div className="min-w-0 space-y-4">{children}</div>
      </div>
    </Dialog>
  );
}
