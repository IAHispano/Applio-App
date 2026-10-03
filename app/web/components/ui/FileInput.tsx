"use client";

import { Upload, X } from "lucide-react";
import React, { useRef, useState } from "react";
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
  onChange,
  onFileSelect,
}: FileInputProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);

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
        aria-label={ariaLabel}
        onChange={handleChange}
        className="hidden"
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        icon={<Upload size={13} className="text-neutral-300" />}
        className="shrink-0"
      >
        {buttonText || (multiple ? t("Choose files") : t("Choose file"))}
      </Button>

      <span
        title={selectedNames.join(", ")}
        className={`text-xs truncate flex-1 min-w-0 font-mono ${
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
          className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
