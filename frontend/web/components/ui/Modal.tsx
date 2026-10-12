"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";

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
  const { t } = useI18n();
  const generatedId = useId();
  const titleId = `modal-title-${generatedId}`;
  const descId = `modal-desc-${generatedId}`;
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Focus management & Escape key
  useEffect(() => {
    if (!isOpen) return;

    // Save previous active element to restore focus on close
    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    // Focus the modal container
    modalRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      // Trap focus inside modal
      if (e.key === "Tab" && modalRef.current) {
        const focusables = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.getClientRects().length > 0 && !element.closest("[hidden], [inert]"));
        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === modalRef.current) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || document.activeElement === modalRef.current) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    // Prevent background scroll
    const origOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = origOverflow;
      previousActiveElementRef.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") return null;

  const widthClass = {
    sm: "max-w-md",
    md: "max-w-xl",
    lg: "max-w-3xl",
    xl: "max-w-4xl",
    "2xl": "max-w-5xl",
  }[maxWidth || size];

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click closes modal
    <div
      className="app-modal fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-sm modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
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
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close dialog")}
            className="text-[var(--muted)] hover:text-[var(--heading)] rounded-lg p-1.5 transition-colors hover:bg-[var(--surface)] shrink-0 cursor-pointer -mr-1 -mt-1"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="min-w-0 space-y-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
