"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface CustomSelectOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  disabled?: boolean;
}

export interface CustomSelectChangeEvent {
  target: {
    value: string;
    name?: string;
  };
  currentTarget: {
    value: string;
  };
}

export interface CustomSelectProps {
  id?: string;
  name?: string;
  value?: string | number;
  defaultValue?: string | number;
  options?: (CustomSelectOption | string)[];
  onChange?: (e: CustomSelectChangeEvent) => void;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  children?: React.ReactNode;
}

interface MenuPosition {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
}

export default function CustomSelect({
  id: propId,
  name,
  value: controlledValue,
  defaultValue,
  options: propOptions,
  onChange,
  onValueChange,
  placeholder = "Select…",
  disabled = false,
  searchable: explicitSearchable,
  searchPlaceholder = "Search options…",
  className = "",
  size = "md",
  children,
}: CustomSelectProps) {
  const generatedId = useId();
  const id = propId || generatedId;

  // Supports propOptions and <option> children.
  const parsedOptions = useMemo<CustomSelectOption[]>(() => {
    const list: CustomSelectOption[] = [];

    if (propOptions && propOptions.length > 0) {
      for (const item of propOptions) {
        if (typeof item === "string" || typeof item === "number") {
          list.push({ value: String(item), label: String(item) });
        } else if (item && typeof item === "object") {
          list.push({
            value: String(item.value),
            label: item.label ?? String(item.value),
            description: item.description,
            badge: item.badge,
            disabled: item.disabled,
          });
        }
      }
    }

    // 2. From children (<option>)
    if (children) {
      React.Children.forEach(children, (child) => {
        if (React.isValidElement(child)) {
          const props = child.props as {
            value?: string | number;
            children?: React.ReactNode;
            disabled?: boolean;
          };
          const val = props.value !== undefined ? String(props.value) : "";
          const lbl =
            typeof props.children === "string" || typeof props.children === "number"
              ? String(props.children)
              : val;
          list.push({
            value: val,
            label: lbl || val,
            disabled: props.disabled,
          });
        }
      });
    }

    return list;
  }, [propOptions, children]);

  // Internal state for uncontrolled or fallback
  const [internalValue, setInternalValue] = useState<string>(() => {
    if (controlledValue !== undefined) return String(controlledValue);
    if (defaultValue !== undefined) return String(defaultValue);
    return parsedOptions[0]?.value || "";
  });

  const selectedValue = controlledValue !== undefined ? String(controlledValue) : internalValue;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [mounted, setMounted] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Filter options if searchable
  const isSearchable = explicitSearchable ?? parsedOptions.length > 10;

  const filteredOptions = useMemo(() => {
    if (!isSearchable || !search.trim()) return parsedOptions;
    const q = search.toLowerCase();
    return parsedOptions.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.value.toLowerCase().includes(q) ||
        opt.description?.toLowerCase().includes(q),
    );
  }, [parsedOptions, search, isSearchable]);

  const selectedOption = parsedOptions.find((opt) => opt.value === selectedValue);

  const displayLabel = selectedOption
    ? selectedOption.label
    : selectedValue
      ? String(selectedValue)
      : placeholder;

  // Floating menu position calculation
  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 220 && rect.top > spaceBelow;
    const width = Math.max(rect.width, 160);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));

    if (openUp) {
      setMenuPos({
        left,
        width,
        bottom: Math.max(8, window.innerHeight - rect.top + gap),
      });
    } else {
      setMenuPos({
        left,
        width,
        top: Math.min(rect.bottom + gap, window.innerHeight - 80),
      });
    }
  }, []);

  // Open / Close handler
  const handleOpen = () => {
    if (disabled) return;
    updatePosition();
    setOpen(true);
    setSearch("");
    const curIdx = filteredOptions.findIndex((o) => o.value === selectedValue);
    setHighlightedIndex(curIdx >= 0 ? curIdx : 0);
  };

  const handleClose = () => {
    setOpen(false);
    setSearch("");
    setHighlightedIndex(-1);
    triggerRef.current?.focus();
  };

  // Selection handler
  const handleSelect = (val: string) => {
    if (controlledValue === undefined) {
      setInternalValue(val);
    }
    setOpen(false);
    setSearch("");

    // Notify onChange listeners with synthetic event
    const evt: CustomSelectChangeEvent = {
      target: { value: val, name },
      currentTarget: { value: val },
    };
    onChange?.(evt);
    onValueChange?.(val);
    triggerRef.current?.focus();
  };

  // Click outside listener
  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      handleClose();
    };
    const handleScrollOrResize = () => {
      updatePosition();
    };

    window.addEventListener("mousedown", handleOutside);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      window.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open, updatePosition]);

  // Focus search input when opened
  useEffect(() => {
    if (open && isSearchable) {
      setTimeout(() => searchInputRef.current?.focus(), 40);
    }
  }, [open, isSearchable]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        handleOpen();
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        const target = filteredOptions[highlightedIndex];
        if (!target.disabled) handleSelect(target.value);
      }
    }
  };

  // Size styling tokens
  const sizeClasses =
    size === "sm"
      ? "h-8 px-2.5 text-xs rounded-lg"
      : size === "lg"
        ? "h-11 px-3.5 text-sm rounded-xl"
        : "h-10 px-3 text-xs sm:text-sm rounded-xl";

  return (
    <div className={`relative inline-block w-full text-left ${className}`}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        name={name}
        disabled={disabled}
        onClick={() => (open ? handleClose() : handleOpen())}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selectedOption ? selectedOption.label : placeholder}
        className={`w-full flex items-center justify-between gap-2 bg-[var(--input-bg)] border transition-all select-none cursor-pointer text-left ${sizeClasses} ${
          open ? "border-[var(--border)]" : "border-[var(--border)] hover:border-white/20"
        } ${disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : "hover:bg-white/[0.03]"}`}
      >
        <span
          className={`truncate flex-1 ${
            selectedOption || selectedValue ? "text-[var(--text)] font-bold" : "text-neutral-500"
          }`}
        >
          {displayLabel}
        </span>

        {selectedOption?.badge && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-neutral-300 font-mono shrink-0">
            {selectedOption.badge}
          </span>
        )}

        <ChevronDown
          size={14}
          className={`text-neutral-400 shrink-0 transition-transform duration-200 ${
            open ? "rotate-180 text-white" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {/* Floating Menu in Portal */}
      {mounted &&
        open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={placeholder}
            style={{
              position: "fixed",
              left: menuPos.left,
              width: menuPos.width,
              ...(menuPos.top !== undefined ? { top: menuPos.top } : {}),
              ...(menuPos.bottom !== undefined ? { bottom: menuPos.bottom } : {}),
            }}
            className="z-[99999] bg-[#121212] border border-white/15 rounded-xl shadow-2xl overflow-hidden backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 select-none"
          >
            {isSearchable && (
              <div className="flex items-center gap-2 px-3.5 py-2 border-b border-white/10">
                <Search size={13} className="text-neutral-500 shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full bg-transparent border-0 text-xs text-white placeholder-neutral-600 focus:outline-hidden p-0"
                />
              </div>
            )}

            {/* Options List */}
            <div className="max-h-64 overflow-y-auto scrollbar-thin py-1">
              {filteredOptions.length === 0 ? (
                <div className="py-3 px-3.5 text-center text-xs text-neutral-500">No matching options</div>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const isSelected = opt.value === selectedValue;

                  return (
                    <button
                      key={`${opt.value}-${idx}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={opt.disabled}
                      onClick={() => !opt.disabled && handleSelect(opt.value)}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      className={`menu-option w-full px-3.5 py-2 text-xs flex items-center justify-between text-left cursor-pointer border-0 rounded-none bg-transparent ${
                        isSelected ? "text-white font-bold" : "text-neutral-400 hover:text-neutral-200"
                      } ${opt.disabled ? "opacity-35 cursor-not-allowed" : ""}`}
                    >
                      <div className="min-w-0 flex-1 flex flex-col">
                        <span className="truncate">{opt.label}</span>
                        {opt.description && (
                          <span className="text-[10px] truncate text-neutral-500">{opt.description}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {opt.badge && (
                          <span className="text-[10px] font-mono text-neutral-500">{opt.badge}</span>
                        )}
                        {isSelected && <Check size={14} className="text-white shrink-0" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
