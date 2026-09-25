"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

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
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

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
        onClose();
        return;
      }

      // Trap focus inside modal
      if (e.key === "Tab" && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
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
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const widthClass = {
    sm: "max-w-md",
    md: "max-w-xl",
    lg: "max-w-3xl",
    xl: "max-w-4xl",
    "2xl": "max-w-5xl",
  }[maxWidth || size];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click closes modal
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
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
        className={`w-full ${widthClass} max-h-[calc(100dvh-1.5rem)] overflow-y-auto overflow-x-hidden min-w-0 bg-neutral-900 border ${
          danger ? "border-red-500/30 shadow-red-500/10" : "border-white/15"
        } rounded-2xl p-4 sm:p-6 shadow-2xl space-y-4 focus:outline-none`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && (
              <span aria-hidden="true" className="shrink-0">
                {icon}
              </span>
            )}
            <div className="space-y-0.5 min-w-0">
              <h2 id={titleId} className="text-lg font-bold text-white tracking-tight m-0">
                {title}
              </h2>
              {description && (
                <p id={descId} className="text-xs text-neutral-400 m-0">
                  {description}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-neutral-400 hover:text-white rounded-lg p-1 transition-colors hover:bg-white/10 shrink-0 cursor-pointer -mr-1 -mt-1"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="min-w-0 space-y-4">{children}</div>
      </div>
    </div>
  );
}
