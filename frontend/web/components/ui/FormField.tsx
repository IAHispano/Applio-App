"use client";

import type React from "react";
import { Children, cloneElement, Fragment, isValidElement, memo, useId } from "react";

interface ControlProps {
  id?: string;
  children?: React.ReactNode;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
}

function controlId(children: React.ReactNode): string | undefined {
  for (const child of Children.toArray(children)) {
    if (!isValidElement<ControlProps>(child)) continue;
    if (
      child.props.id &&
      (typeof child.type !== "string" || ["input", "select", "textarea"].includes(child.type))
    )
      return child.props.id;
    if (typeof child.type === "string" || child.type === Fragment) {
      const nested = controlId(child.props.children);
      if (nested) return nested;
    }
  }
}

export interface FormFieldProps {
  /** Form field label */
  label?: React.ReactNode;
  /** HTML for attribute linking label to input */
  htmlFor?: string;
  /** Optional secondary help text */
  description?: React.ReactNode;
  /** Optional error message */
  error?: React.ReactNode;
  /** Whether the field is required */
  required?: boolean;
  /** Optional badge or counter on the right of the label row */
  badge?: React.ReactNode;
  /** Children form controls (input, select, etc.) */
  children: React.ReactNode;
  /** Extra container CSS classes */
  className?: string;
}

function FormFieldInner({
  label,
  htmlFor: customHtmlFor,
  description,
  error,
  required = false,
  badge,
  children,
  className = "",
}: FormFieldProps) {
  const autoId = useId();
  const htmlFor = customHtmlFor || controlId(children) || `field-${autoId}`;
  const descId = description ? `${htmlFor}-desc` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  let linked = false;
  const linkControl = (nodes: React.ReactNode): React.ReactNode =>
    Children.map(nodes, (child) => {
      if (!isValidElement<ControlProps>(child)) return child;
      const native = typeof child.type === "string" && ["input", "select", "textarea"].includes(child.type);
      if (!linked && (child.props.id === htmlFor || (native && !child.props.id))) {
        linked = true;
        const descriptions = [
          ...new Set(
            [child.props["aria-describedby"], error ? errorId : descId]
              .filter(Boolean)
              .join(" ")
              .split(/\s+/)
              .filter(Boolean),
          ),
        ].join(" ");
        return cloneElement(child, {
          id: htmlFor,
          required: required || child.props.required,
          "aria-describedby": descriptions || undefined,
          "aria-invalid": error ? true : child.props["aria-invalid"],
        });
      }
      return typeof child.type === "string" || child.type === Fragment
        ? cloneElement(child, { children: linkControl(child.props.children) })
        : child;
    });

  return (
    <div className={`form-field space-y-2 min-w-0 ${className}`}>
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label
            id={`${htmlFor}-label`}
            htmlFor={htmlFor}
            className="block text-xs font-medium text-[var(--text)] select-none"
          >
            {label}
            {required && (
              <span aria-hidden="true" className="text-red-400 ml-0.5">
                *
              </span>
            )}
          </label>
          {badge && <span className="text-[10px] text-neutral-400">{badge}</span>}
        </div>
      )}
      <div>{linkControl(children)}</div>
      {description && !error && (
        <p id={descId} className="field-help m-0">
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-[11px] text-red-400 font-medium m-0 leading-relaxed" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const FormField = memo(FormFieldInner);
export default FormField;
