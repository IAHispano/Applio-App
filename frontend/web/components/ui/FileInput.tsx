"use client";

import { Upload, X } from "lucide-react";
import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

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

  let labelText = placeholder ?? t("No file chosen");
  if (selectedNames.length === 1) {
    labelText = selectedNames[0];
  } else if (selectedNames.length > 1) {
    labelText = t("{count} files selected", { count: selectedNames.length });
  }

  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-white/10 bg-[var(--input-bg,#121212)] transition-colors hover:border-white/20 min-w-0 ${
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
        size="sm"
        variant="ghost"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={!ariaLabel && labelId ? `${labelId} ${statusId}-button` : undefined}
        aria-describedby={[descriptionId, statusId].filter(Boolean).join(" ")}
        aria-invalid={invalid}
        onClick={() => inputRef.current?.click()}
        icon={<Upload size={13} className="text-neutral-300" />}
        className="shrink-0"
      >
        <span id={`${statusId}-button`}>
          {buttonText || (multiple ? t("Choose files") : t("Choose file"))}
        </span>
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
        <button
          type="button"
          onClick={handleClear}
          title={t("Clear file selection")}
          aria-label={t("Clear file selection")}
          className="p-1 min-w-7 min-h-7 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
