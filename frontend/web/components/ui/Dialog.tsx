"use client";

import {
  createContext,
  type DialogHTMLAttributes,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
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
  initialFocus?: RefObject<HTMLElement | null>;
}

/** Native modal behavior makes the background inert and supports stacked dialogs. */
export default function Dialog({
  isOpen,
  onClose,
  initialFocus,
  children,
  className = "",
  ...props
}: DialogProps) {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const backdropPress = useRef(false);
  useEffect(() => {
    if (!isOpen || !dialog) return;
    const previous = document.activeElement;
    dialog.showModal();
    if (openDialogs++ === 0) {
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    initialFocus?.current?.focus({ preventScroll: true });
    return () => {
      backdropPress.current = false;
      if (dialog.open) dialog.close();
      if (--openDialogs === 0) document.body.style.overflow = bodyOverflow;
      if (previous instanceof HTMLElement && previous.isConnected && !previous.closest("dialog:not([open])"))
        previous.focus({ preventScroll: true });
    };
  }, [dialog, isOpen, initialFocus]);

  if (!isOpen || typeof document === "undefined") return null;
  return createPortal(
    <dialog
      {...props}
      ref={setDialog}
      aria-modal="true"
      className={`app-dialog ${className}`}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (event.defaultPrevented || event.key !== "Tab") return;
        const modal = event.currentTarget;
        // React bubbles events through portals, including separately opened dialogs.
        if (!modal.contains(event.target as Node)) return;
        const controls = Array.from(
          modal.querySelectorAll<HTMLElement>(
            "a[href], button, input, select, textarea, summary, iframe, audio[controls], video[controls], [tabindex]",
          ),
        ).filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(":disabled") &&
            !element.closest("[inert]") &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility === "visible",
        );
        const boundary = event.shiftKey ? controls[0] : controls.at(-1);
        const opposite = event.shiftKey ? controls.at(-1) : controls[0];
        const active = document.activeElement;
        const pastBoundary = event.shiftKey
          ? Node.DOCUMENT_POSITION_PRECEDING
          : Node.DOCUMENT_POSITION_FOLLOWING;
        if (
          !boundary ||
          active === modal ||
          active === boundary ||
          (active && boundary.compareDocumentPosition(active) & pastBoundary)
        ) {
          event.preventDefault();
          (opposite || modal).focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
      }}
      onPointerDown={(event) => {
        props.onPointerDown?.(event);
        backdropPress.current = !event.defaultPrevented && event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        props.onPointerUp?.(event);
        if (event.target !== event.currentTarget || event.defaultPrevented) backdropPress.current = false;
      }}
      onClick={(event) => {
        props.onClick?.(event);
        const startedOnBackdrop = backdropPress.current;
        backdropPress.current = false;
        if (startedOnBackdrop && event.target === event.currentTarget && !event.defaultPrevented) onClose?.();
      }}
    >
      <PortalTarget.Provider value={dialog}>{children}</PortalTarget.Provider>
    </dialog>,
    document.body,
  );
}
