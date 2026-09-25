"use client";

import type React from "react";
import { memo, useId } from "react";

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
  const htmlFor = customHtmlFor || `field-${autoId}`;
  const descId = description ? `${htmlFor}-desc` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={htmlFor} className="block text-xs font-medium text-neutral-300 select-none">
            {label}
            {required && <span className="text-red-400 ml-0.5">*</span>}
          </label>
          {badge && <span className="text-[10px] text-neutral-400">{badge}</span>}
        </div>
      )}
      <div>{children}</div>
      {description && !error && (
        <p id={descId} className="text-[11px] text-neutral-500 m-0 leading-relaxed">
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
