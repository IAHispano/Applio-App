"use client";

import { Upload, X } from "lucide-react";
import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import Button from "./Button";

export interface FileInputProps {
  id?: string;
  name?: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  buttonText?: string;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  required?: boolean;
  onChange?: (files: FileList | null) => void;
  onFileSelect?: (file: File | null) => void;
}

export default function FileInput({
  id,
  name,
  accept,
  multiple = false,
  disabled = false,
  buttonText,
  placeholder,
  className = "",
  ariaLabel,
  "aria-describedby": descriptionId,
  "aria-invalid": invalid,
  required,
  onChange,
  onFileSelect,
}: FileInputProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const generatedId = useId();
  const statusId = `file-selection-${generatedId}`;
  const [labelId, setLabelId] = useState<string>();
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  useEffect(() => {
    const label = id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`) : null;
    if (label && !label.id) label.id = `${id}-label`;
    setLabelId(label?.id);
  }, [id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList && fileList.length > 0) {
      const names = Array.from(fileList).map((f) => f.name);
      setSelectedNames(names);
      onChange?.(fileList);
      onFileSelect?.(fileList[0]);
    } else {
      setSelectedNames([]);
      onChange?.(null);
      onFileSelect?.(null);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    setSelectedNames([]);
    onChange?.(null);
    onFileSelect?.(null);
    triggerRef.current?.focus();
  };

  const chooseLabel = buttonText || (multiple ? t("Choose files") : t("Choose file"));
  let labelText = placeholder ?? t("No file chosen");
  if (selectedNames.length === 1) {
    labelText = selectedNames[0];
  } else if (selectedNames.length > 1) {
    labelText = t("{count} files selected", { count: selectedNames.length });
  }

  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-1.5 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--input-bg)] transition-colors hover:border-[var(--focus-border)] min-w-0 ${
        disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : ""
      } ${className}`}
    >
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel}
        onChange={handleChange}
        className="hidden"
      />
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        disabled={disabled}
        aria-label={ariaLabel}
        title={chooseLabel}
        aria-labelledby={!ariaLabel && labelId ? `${labelId} ${statusId}-button` : undefined}
        aria-describedby={[descriptionId, statusId].filter(Boolean).join(" ")}
        aria-invalid={invalid}
        onClick={() => inputRef.current?.click()}
        icon={<Upload size={13} className="text-neutral-300" />}
        className="shrink-0"
      >
        <span id={`${statusId}-button`}>{chooseLabel}</span>
      </Button>

      <span
        id={statusId}
        aria-live="polite"
        aria-atomic="true"
        title={selectedNames.join(", ")}
        className={`text-xs truncate flex-1 min-w-0 font-sans ${
          selectedNames.length > 0 ? "text-neutral-200 font-medium" : "text-neutral-500"
        }`}
      >
        {labelText}
      </span>

      {selectedNames.length > 0 && !disabled && (
        <Button
          variant="ghost"
          onClick={handleClear}
          title={t("Clear file selection")}
          aria-label={t("Clear file selection")}
          icon={<X />}
        />
      )}
    </div>
  );
}
