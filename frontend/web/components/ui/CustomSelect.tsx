"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type MenuPosition, positionFloatingMenu } from "@/lib/floating-menu";
import { useI18n } from "@/lib/i18n";
import { PITCH_METHOD_HELP } from "@/lib/setting-help";
import { useDialogPortalTarget } from "./Dialog";
import SettingHelp from "./SettingHelp";

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
  onOpen?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Show the search field. Defaults to true for every dropdown. */
  searchable?: boolean;
  searchPlaceholder?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  children?: React.ReactNode;
  description?: React.ReactNode;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  required?: boolean;
}

const INITIAL_ROW_BUDGET = 60;
const LOAD_MORE_ROWS = 120;

export default function CustomSelect({
  id: propId,
  name,
  value: controlledValue,
  defaultValue,
  options: propOptions,
  onChange,
  onValueChange,
  onOpen,
  placeholder: customPlaceholder,
  disabled = false,
  searchable: explicitSearchable,
  searchPlaceholder: customSearchPlaceholder,
  className = "",
  size = "md",
  children,
  description,
  "aria-describedby": externalDescription,
  "aria-invalid": invalid,
  required,
}: CustomSelectProps) {
  const { t } = useI18n();
  const portalTarget = useDialogPortalTarget();
  const placeholder = customPlaceholder ?? t("Select…");
  const searchPlaceholder = customSearchPlaceholder ?? t("Search options…");
  const generatedId = useId();
  const id = propId || generatedId;
  const menuId = `${id}-menu`;

  // Supports propOptions and <option> children.
  const parsedOptions = useMemo<CustomSelectOption[]>(() => {
    const list: CustomSelectOption[] = [];

    if (propOptions && propOptions.length > 0) {
      for (const item of propOptions) {
        if (typeof item === "string" || typeof item === "number") {
          const s = String(item);
          list.push({ value: s, label: s.toLowerCase() === "none" ? t("None") : s });
        } else if (item && typeof item === "object") {
          const rawLbl = item.label ?? String(item.value);
          const lbl = String(rawLbl).toLowerCase() === "none" ? t("None") : rawLbl;
          list.push({
            value: String(item.value),
            label: lbl,
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
          const rawLbl =
            typeof props.children === "string" || typeof props.children === "number"
              ? String(props.children)
              : val;
          const lbl = String(rawLbl).toLowerCase() === "none" ? t("None") : rawLbl || val;
          list.push({
            value: val,
            label: lbl,
            disabled: props.disabled,
          });
        }
      });
    }

    return list.map((option) => ({
      ...option,
      description:
        option.description ??
        (PITCH_METHOD_HELP[option.value] ? t(PITCH_METHOD_HELP[option.value]) : undefined),
    }));
  }, [propOptions, children, t]);

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
  const [highlightedValue, setHighlightedValue] = useState<string | null>(null);
  const revealHighlight = useRef(true);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Filter options if searchable (on by default: every dropdown is searchable;
  // pass searchable={false} to opt out for tiny fixed lists).
  const isSearchable = explicitSearchable ?? true;

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

  // Large lists render in letter groups with scroll-to-load-more: filtering
  // thousands of options is cheap, mounting thousands of rows is not. Only
  // the rows inside the scroll window exist in the DOM; more load as you
  // scroll. Small lists render fully with no headers.
  const groupedMode = filteredOptions.length > INITIAL_ROW_BUDGET;

  const letterOf = (label: string) => {
    const first = (label.trim()[0] || "#").toUpperCase();
    return first >= "A" && first <= "Z" ? first : "#";
  };

  const [visibleCount, setVisibleCount] = useState(INITIAL_ROW_BUDGET);
  const visibleSlice = groupedMode ? filteredOptions.slice(0, visibleCount) : [];
  const remainingRows = groupedMode ? filteredOptions.length - visibleSlice.length : 0;

  // An option keeps its identity when a refresh inserts or reorders values.
  const navRows = groupedMode ? visibleSlice : filteredOptions;
  const requestedIndex = navRows.findIndex((option) => option.value === highlightedValue && !option.disabled);
  const highlightedIndex =
    requestedIndex >= 0 ? requestedIndex : navRows.findIndex((option) => !option.disabled);
  const activeOptionId = highlightedIndex >= 0 ? `${id}-opt-${highlightedIndex}` : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: rerun after the active row or menu geometry changes
  useEffect(() => {
    if (open && revealHighlight.current) activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, search, activeOptionId, menuPos?.maxHeight]);

  function showMoreRows() {
    setVisibleCount((c) => c + LOAD_MORE_ROWS);
  }

  const displayLabel = selectedOption
    ? String(selectedOption.label).toLowerCase() === "none"
      ? t("None")
      : selectedOption.label
    : selectedValue
      ? String(selectedValue).toLowerCase() === "none"
        ? t("None")
        : String(selectedValue)
      : placeholder;

  // Floating menu position calculation
  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === "undefined") return;
    setMenuPos(positionFloatingMenu(el, 160, isSearchable ? 120 : 56));
  }, [isSearchable]);

  // Open / Close handler
  const handleOpen = () => {
    if (disabled) return;
    updatePosition();
    setOpen(true);
    setSearch("");
    setVisibleCount(INITIAL_ROW_BUDGET);
    revealHighlight.current = true;
    setHighlightedValue(selectedValue);
    onOpen?.();
  };

  const dismiss = useCallback(() => {
    setOpen(false);
    setSearch("");
    setHighlightedValue(null);
  }, []);

  const handleClose = () => {
    dismiss();
    triggerRef.current?.focus({ preventScroll: true });
  };

  // Selection handler
  const handleSelect = (val: string) => {
    if (controlledValue === undefined) {
      setInternalValue(val);
    }
    handleClose();

    // Notify onChange listeners with synthetic event
    const evt: CustomSelectChangeEvent = {
      target: { value: val, name },
      currentTarget: { value: val },
    };
    onChange?.(evt);
    onValueChange?.(val);
  };

  useEffect(() => {
    if (disabled) dismiss();
  }, [disabled, dismiss]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: Event) => {
      if (!(event.target instanceof Node)) return;
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) dismiss();
    };
    const handleScrollOrResize = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      updatePosition();
    };

    const viewport = window.visualViewport;
    window.addEventListener("pointerdown", handleOutside);
    window.addEventListener("focusin", handleOutside);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    viewport?.addEventListener("resize", handleScrollOrResize);
    viewport?.addEventListener("scroll", handleScrollOrResize);

    return () => {
      window.removeEventListener("pointerdown", handleOutside);
      window.removeEventListener("focusin", handleOutside);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
      viewport?.removeEventListener("resize", handleScrollOrResize);
      viewport?.removeEventListener("scroll", handleScrollOrResize);
    };
  }, [open, dismiss, updatePosition]);

  // An explicit aria-label would override an external <label htmlFor>
  // (verified in Chromium: the visible label drops out of the accessible
  // name). Instead wire the trigger to that label plus its own value, so a
  // screen reader hears e.g. "Input Device Default, button, collapsed".
  // Without an external label the button content alone names it, as before.
  useEffect(() => {
    const btn = triggerRef.current;
    if (!btn || typeof document === "undefined") return;
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    const valueEl = document.getElementById(`${id}-val`);
    if (label && valueEl) {
      if (!label.id) label.id = `${id}-label`;
      btn.setAttribute("aria-labelledby", `${label.id} ${id}-val`);
    } else {
      btn.removeAttribute("aria-labelledby");
    }
  }, [id]);

  // Focus search input when opened
  useEffect(() => {
    if (open && isSearchable) {
      const timer = setTimeout(() => searchInputRef.current?.focus({ preventScroll: true }), 0);
      return () => clearTimeout(timer);
    }
  }, [open, isSearchable]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || e.nativeEvent.isComposing) return;

    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        handleOpen();
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      handleClose();
    } else if (e.key === "Tab") {
      // Return to the trigger before the browser advances to the next field.
      handleClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
    } else if ((e.key === "Home" || e.key === "End") && e.target !== searchInputRef.current) {
      e.preventDefault();
      const next =
        e.key === "Home"
          ? filteredOptions.findIndex((option) => !option.disabled)
          : filteredOptions.findLastIndex((option) => !option.disabled);
      if (next >= 0) revealOption(next);
    } else if (e.key === "Enter" || (!isSearchable && e.key === " ")) {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < navRows.length) {
        const target = navRows[highlightedIndex];
        if (!target.disabled) handleSelect(target.value);
      }
    }
  };

  function revealOption(index: number) {
    if (groupedMode && index >= visibleCount) setVisibleCount(index + LOAD_MORE_ROWS);
    revealHighlight.current = true;
    setHighlightedValue(filteredOptions[index].value);
  }

  function highlightFromPointer(option: CustomSelectOption) {
    if (option.disabled) return;
    revealHighlight.current = false;
    setHighlightedValue(option.value);
  }
  function moveHighlight(direction: number) {
    if (!filteredOptions.length) return;
    const origin = highlightedIndex < 0 ? (direction > 0 ? -1 : 0) : highlightedIndex;
    for (let offset = 1; offset <= filteredOptions.length; offset++) {
      const next = (origin + direction * offset + filteredOptions.length) % filteredOptions.length;
      if (!filteredOptions[next].disabled) {
        revealOption(next);
        return;
      }
    }
  }

  // Size styling tokens
  const sizeClasses =
    size === "sm"
      ? "h-9 px-3 text-xs rounded-lg"
      : size === "lg"
        ? "h-12 px-4 text-sm rounded-xl"
        : "h-11 px-3.5 text-sm rounded-xl";

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
        role="combobox"
        aria-describedby={
          [externalDescription, description ? `${id}-help` : undefined].filter(Boolean).join(" ") || undefined
        }
        aria-haspopup="listbox"
        aria-invalid={invalid}
        aria-required={required || undefined}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={open && !isSearchable ? activeOptionId : undefined}
        className={`w-full flex items-center justify-between gap-2 bg-[var(--input-bg)] border transition-all select-none cursor-pointer text-left ${sizeClasses} ${
          open ? "border-[var(--focus-border)]" : "border-[var(--border)] hover:border-[var(--focus-border)]"
        } ${disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : "hover:bg-[var(--surface)]"}`}
      >
        <span
          id={`${id}-val`}
          className={`truncate flex-1 ${
            selectedOption || selectedValue ? "text-[var(--text)] font-semibold" : "text-[var(--muted)]"
          }`}
        >
          {displayLabel}
        </span>

        {selectedOption?.badge && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-neutral-300 font-sans shrink-0">
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
      <SettingHelp text={description} controlId={id} />

      {/* Floating Menu in Portal */}
      {mounted &&
        open &&
        menuPos &&
        portalTarget &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: menuPos.maxHeight,
              ...(menuPos.top !== undefined ? { top: menuPos.top } : {}),
              ...(menuPos.bottom !== undefined ? { bottom: menuPos.bottom } : {}),
            }}
            className="menu-pop z-[99999] bg-[var(--panel)] text-[var(--text)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden select-none flex flex-col"
          >
            {isSearchable && (
              <div className="flex shrink-0 items-center gap-2 px-3.5 py-2">
                <Search size={13} className="text-[var(--muted)] shrink-0" aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setVisibleCount(INITIAL_ROW_BUDGET);
                    if (listRef.current) listRef.current.scrollTop = 0;
                    revealHighlight.current = true;
                    setHighlightedValue(null);
                  }}
                  onKeyDown={handleKeyDown}
                  role="combobox"
                  aria-label={searchPlaceholder}
                  aria-expanded="true"
                  aria-autocomplete="list"
                  aria-controls={menuId}
                  aria-activedescendant={activeOptionId}
                  placeholder={searchPlaceholder}
                  className="w-full !bg-transparent !border-0 text-xs text-[var(--text)] !p-0"
                />
              </div>
            )}

            {/* Options List */}
            <div
              ref={listRef}
              id={menuId}
              role="listbox"
              aria-label={placeholder}
              className="min-h-0 max-h-64 overflow-y-auto scrollbar-thin py-1"
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120 && remainingRows > 0) {
                  showMoreRows();
                }
              }}
            >
              {filteredOptions.length === 0 ? (
                <div
                  role="option"
                  tabIndex={-1}
                  aria-selected="false"
                  aria-disabled="true"
                  className="py-3 px-3.5 text-center text-xs text-[var(--muted)]"
                >
                  {t("No matching options")}
                </div>
              ) : groupedMode ? (
                <>
                  {(() => {
                    let rowIdx = -1;
                    let lastLetter = "";
                    return visibleSlice.map((opt) => {
                      rowIdx += 1;
                      const idx = rowIdx;
                      const letter = letterOf(opt.label);
                      const header = letter !== lastLetter ? letter : null;
                      lastLetter = letter;
                      const isSelected = opt.value === selectedValue;
                      return (
                        <div key={`${opt.value}-${idx}`}>
                          {header && (
                            <div
                              aria-hidden="true"
                              className="sticky top-0 z-10 bg-[var(--panel)] px-3.5 py-1 text-[10px] font-semibold tracking-wider text-[var(--muted)] uppercase select-none"
                            >
                              {header}
                            </div>
                          )}
                          <button
                            type="button"
                            role="option"
                            ref={highlightedIndex === idx ? activeOptionRef : undefined}
                            id={`${id}-opt-${idx}`}
                            tabIndex={-1}
                            aria-selected={isSelected}
                            data-active={highlightedIndex === idx || undefined}
                            aria-setsize={filteredOptions.length}
                            aria-posinset={idx + 1}
                            disabled={opt.disabled}
                            onClick={() => !opt.disabled && handleSelect(opt.value)}
                            onMouseEnter={() => highlightFromPointer(opt)}
                            className={`menu-option w-full px-3.5 py-2 text-xs scroll-mt-6 flex items-center justify-between text-left cursor-pointer border-0 rounded-none bg-transparent ${
                              isSelected ? "text-white font-bold" : "text-neutral-400 hover:text-neutral-200"
                            } ${opt.disabled ? "opacity-35 cursor-not-allowed" : ""}`}
                          >
                            <div className="min-w-0 flex-1 flex flex-col">
                              <span className="truncate">{opt.label}</span>
                              {opt.description && (
                                <span className="text-[10px] truncate text-neutral-500">
                                  {opt.description}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                              {opt.badge && (
                                <span className="text-[10px] font-sans text-neutral-500">{opt.badge}</span>
                              )}
                              {isSelected && <Check size={14} className="text-white shrink-0" />}
                            </div>
                          </button>
                        </div>
                      );
                    });
                  })()}
                  {remainingRows > 0 && (
                    <div className="py-2 px-3.5 text-center text-[11px] text-neutral-500">
                      {t("+{remaining} more — scroll for more", { remaining: remainingRows })}
                    </div>
                  )}
                </>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const isSelected = opt.value === selectedValue;

                  return (
                    <button
                      key={`${opt.value}-${opt.label}`}
                      type="button"
                      role="option"
                      ref={highlightedIndex === idx ? activeOptionRef : undefined}
                      id={`${id}-opt-${idx}`}
                      tabIndex={-1}
                      aria-selected={isSelected}
                      data-active={highlightedIndex === idx || undefined}
                      disabled={opt.disabled}
                      onClick={() => !opt.disabled && handleSelect(opt.value)}
                      onMouseEnter={() => highlightFromPointer(opt)}
                      className={`menu-option w-full px-3.5 py-2 text-xs flex items-center justify-between text-left cursor-pointer border-0 rounded-none bg-transparent ${
                        isSelected ? "text-white font-bold" : "text-neutral-400 hover:text-neutral-200"
                      } ${opt.disabled ? "opacity-35 cursor-not-allowed" : ""}`}
                    >
                      <div className="min-w-0 flex-1 flex flex-col">
                        <span className="truncate">{opt.label}</span>
                        {opt.description && (
                          <span className="text-[11px] whitespace-normal leading-relaxed text-neutral-400">
                            {opt.description}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {opt.badge && (
                          <span className="text-[10px] font-sans text-neutral-500">{opt.badge}</span>
                        )}
                        {isSelected && <Check size={14} className="text-white shrink-0" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          portalTarget,
        )}
    </div>
  );
}
