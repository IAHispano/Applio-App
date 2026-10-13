"use client";

import { createContext, type DialogHTMLAttributes, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";

const PortalTarget = createContext<HTMLElement | null>(null);
let openDialogs = 0;
let bodyOverflow = "";

/** Keep dropdown portals inside the browser's active modal focus scope. */
export function useDialogPortalTarget() {
  return useContext(PortalTarget) || (typeof document === "undefined" ? null : document.body);
}

interface DialogProps extends Omit<DialogHTMLAttributes<HTMLDialogElement>, "open" | "onClose" | "onCancel"> {
  isOpen: boolean;
  onClose?: () => void;
}

/** Native modal behavior makes the background inert and supports stacked dialogs. */
export default function Dialog({ isOpen, onClose, children, className = "", ...props }: DialogProps) {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    if (!isOpen || !dialog) return;
    const previous = document.activeElement;
    if (openDialogs++ === 0) {
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      if (--openDialogs === 0) document.body.style.overflow = bodyOverflow;
      if (previous instanceof HTMLElement && previous.isConnected && !previous.closest("dialog:not([open])"))
        previous.focus({ preventScroll: true });
    };
  }, [dialog, isOpen]);

  if (!isOpen || typeof document === "undefined") return null;
  return createPortal(
    <dialog
      {...props}
      ref={setDialog}
      aria-modal="true"
      tabIndex={-1}
      className={`app-dialog ${className}`}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (event.defaultPrevented || event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "a[href], button, input, select, textarea, summary, [tabindex]",
          ),
        ).filter(
          (element) =>
            element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0,
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        const active = document.activeElement;
        if (!first) {
          event.preventDefault();
          event.currentTarget.focus();
        } else if (event.shiftKey && (active === first || active === event.currentTarget)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || active === event.currentTarget)) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <PortalTarget.Provider value={dialog}>{children}</PortalTarget.Provider>
    </dialog>,
    document.body,
  );
}
