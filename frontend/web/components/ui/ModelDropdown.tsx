"use client";

import { Check, ChevronDown, Mic2, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";
import { useDialogPortalTarget } from "./Dialog";

export interface ModelDropdownProps {
  models: string[];
  selectedModel: string;
  onSelect: (modelPath: string) => void;
  onRefresh?: () => void;
  onUnload?: () => void;
  indexes?: string[];
  disabled?: boolean;
  /** Use a single-line trigger matching the standard select. */
  compact?: boolean;
  /** DOM id for the trigger, so an external <label htmlFor> can name it. */
  id?: string;
  "aria-describedby"?: string;
}

function modelDisplayName(path: string): string {
  if (!path) return "";
  const filename = path.split(/[\\/]/).pop() || path;
  return filename.replace(/\.(pth|onnx)$/i, "");
}

function modelFolder(path: string): string {
  if (!path) return "";
  const parts = path.split(/[\\/]/);
  if (parts.length > 1) {
    return parts.slice(0, -1).join("/");
  }
  return "logs";
}

interface MenuPosition {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
}

export default function ModelDropdown({
  models,
  selectedModel,
  onSelect,
  onRefresh,
  indexes = [],
  disabled = false,
  compact = false,
  id: customId,
  "aria-describedby": descriptionId,
}: ModelDropdownProps) {
  const { t } = useI18n();
  const generatedId = useId();
  const id = customId || `model-${generatedId}`;
  const listId = `${id}-options`;
  const portalTarget = useDialogPortalTarget();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [mounted, setMounted] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const [highlighted, setHighlighted] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef(new Map<number, HTMLButtonElement | null>());

  useEffect(() => {
    setMounted(true);
  }, []);

  // Same external-label wiring as CustomSelect: a <label htmlFor> names the
  // trigger together with its own content ("Voice Model jenny PTH").
  useEffect(() => {
    const btn = triggerRef.current;
    if (!btn || !id || typeof document === "undefined") return;
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label) {
      if (!label.id) label.id = `${id}-label`;
      btn.setAttribute("aria-labelledby", `${label.id} ${id}`);
    } else {
      btn.removeAttribute("aria-labelledby");
    }
  }, [id]);

  // Opening is a user action; a new callback from the parent must not refetch.
  const openMenu = () => {
    setOpen(true);
    onRefresh?.();
  };

  // Position the floating menu against the trigger button. Rendered in a
  // portal so ancestor cards (backdrop-filter creates a stacking context)
  // can never paint over it.
  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 260 && rect.top > spaceBelow;
    const width = Math.max(rect.width, 240);
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
        top: Math.min(rect.bottom + gap, window.innerHeight - 120),
      });
    }
  }, []);

  const filteredModels = useMemo(() => {
    if (!search.trim()) return models;
    const query = search.toLowerCase();
    return models.filter((m) => m.toLowerCase().includes(query));
  }, [models, search]);

  const hasIndexMatch = (modelPath: string): boolean => {
    const stem = modelDisplayName(modelPath).toLowerCase().slice(0, 8);
    return indexes.some((idx) => idx.toLowerCase().includes(stem));
  };

  const chooseModel = useCallback(
    (modelPath: string | undefined) => {
      if (!modelPath) return;
      onSelect(modelPath);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onSelect],
  );

  const moveHighlight = useCallback(
    (delta: number) => {
      if (filteredModels.length === 0) return;
      setHighlighted((h) => {
        const base = h < 0 ? (delta > 0 ? -1 : 0) : h;
        return (base + delta + filteredModels.length) % filteredModels.length;
      });
    },
    [filteredModels],
  );

  // Reset highlight whenever the menu opens or the list changes.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selected = filteredModels.indexOf(selectedModel);
    setHighlighted(selected >= 0 ? selected : filteredModels.length > 0 ? 0 : -1);
  }, [open, selectedModel, filteredModels]);

  // Keep the highlighted option visible while navigating.
  useEffect(() => {
    if (!open || highlighted < 0) return;
    itemRefs.current.get(highlighted)?.scrollIntoView({ block: "nearest" });
  }, [open, highlighted]);

  // The global listeners below stay registered while the menu is open. Reading
  // the volatile list and handlers through a ref keeps hovering an option or
  // typing in the search box from re-registering them on every change.
  const handlersRef = useRef({ filteredModels, highlighted, moveHighlight, chooseModel });
  useEffect(() => {
    handlersRef.current = { filteredModels, highlighted, moveHighlight, chooseModel };
  });

  useEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updatePosition();

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (!menuRef.current?.contains(e.target as Node) && e.target !== triggerRef.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === "Tab") {
        const controls = Array.from(
          menuRef.current?.querySelectorAll<HTMLElement>(
            'input, button:not([disabled]):not([tabindex="-1"])',
          ) || [],
        );
        if ((e.shiftKey && e.target === controls[0]) || (!e.shiftKey && e.target === controls.at(-1))) {
          setOpen(false);
          triggerRef.current?.focus();
        }
        return;
      }
      if (e.target !== searchInputRef.current && e.target !== triggerRef.current) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        handlersRef.current.moveHighlight(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        handlersRef.current.moveHighlight(-1);
        return;
      }
      if (e.key === "Home") {
        if (e.target === searchInputRef.current) return;
        e.preventDefault();
        setHighlighted(handlersRef.current.filteredModels.length > 0 ? 0 : -1);
        return;
      }
      if (e.key === "End") {
        if (e.target === searchInputRef.current) return;
        e.preventDefault();
        const list = handlersRef.current.filteredModels;
        setHighlighted(list.length > 0 ? list.length - 1 : -1);
        return;
      }
      if (e.key === "Enter") {
        // Let focused option buttons handle Enter natively.
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "BUTTON" || tag === "A") return;
        e.preventDefault();
        const { filteredModels: list, highlighted: index } = handlersRef.current;
        handlersRef.current.chooseModel(list[index] ?? list[0]);
      }
    }
    function handleReposition() {
      updatePosition();
    }
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleReposition);
    // Capture scrolls from any scrollable ancestor (e.g. the main column).
    document.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleReposition);
      document.removeEventListener("scroll", handleReposition, true);
    };
  }, [open, updatePosition]);

  const currentDisplayName = selectedModel ? modelDisplayName(selectedModel) : t("Select a voice model…");

  const menu =
    open && mounted && menuPos && portalTarget
      ? createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              zIndex: 9999,
              left: menuPos.left,
              width: menuPos.width,
              top: menuPos.top,
              bottom: menuPos.bottom,
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-card)",
            }}
            className="menu-pop shadow-2xl overflow-hidden flex flex-col max-h-[min(24rem,calc(100vh-120px))]"
          >
            <div className="px-3.5 py-2 flex items-center gap-2 shrink-0">
              <Search size={13} aria-hidden="true" className="shrink-0" style={{ color: "var(--muted)" }} />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                role="combobox"
                aria-label={t("Search models")}
                aria-expanded="true"
                aria-autocomplete="list"
                aria-controls={listId}
                aria-activedescendant={
                  highlighted >= 0 && highlighted < filteredModels.length
                    ? `${id}-option-${highlighted}`
                    : undefined
                }
                placeholder={t("Search models…")}
                className="w-full bg-transparent text-xs border-none py-1 placeholder:text-[var(--muted)]"
                style={{ color: "var(--text)" }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label={t("Clear search")}
                  className="p-1.5 -m-0.5 rounded transition-colors hover:text-white"
                  style={{ color: "var(--muted)", minWidth: 24, minHeight: 24 }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Model Items List */}
            <div
              id={listId}
              role="listbox"
              aria-label={t("Voice models")}
              className="max-h-64 overflow-y-auto py-1 grow"
            >
              {filteredModels.length === 0 ? (
                <div
                  role="option"
                  tabIndex={-1}
                  aria-selected="false"
                  aria-disabled="true"
                  className="p-4 text-center"
                >
                  <p className="text-xs m-0" style={{ color: "var(--muted)" }}>
                    {search ? t("No models matching search query") : t("No models found in logs/")}
                  </p>
                </div>
              ) : (
                filteredModels.map((m, i) => {
                  const isSelected = m === selectedModel;
                  const hasIndex = hasIndexMatch(m);
                  return (
                    <button
                      key={m}
                      id={`${id}-option-${i}`}
                      ref={(el) => {
                        itemRefs.current.set(i, el);
                      }}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      data-active={highlighted === i || undefined}
                      aria-selected={isSelected}
                      onMouseEnter={() => setHighlighted(i)}
                      onClick={() => chooseModel(m)}
                      className={`menu-option w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left cursor-pointer border-0 rounded-none bg-transparent ${
                        isSelected ? "text-white font-bold" : "text-neutral-400 hover:text-neutral-200"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            title={hasIndex ? t("Index paired") : undefined}
                            style={{
                              background: hasIndex ? "var(--ok)" : "transparent",
                              border: hasIndex ? "none" : "1px solid var(--checkbox-border)",
                            }}
                          />
                          <span
                            className={`text-xs truncate ${isSelected ? "font-bold text-white" : "font-medium"}`}
                          >
                            {modelDisplayName(m)}
                          </span>
                          <span className="text-[10px] font-sans text-[var(--muted)] shrink-0">
                            {m.endsWith(".onnx") ? "ONNX" : "PTH"}
                          </span>
                        </div>
                        <p className="text-[10px] truncate m-0 leading-tight mt-0.5 text-[var(--muted)]">
                          {m} {hasIndex ? `• ${t("Index paired")}` : ""}
                        </p>
                      </div>

                      {isSelected && <Check size={14} className="text-white shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          portalTarget,
        )
      : null;

  return (
    <div className="relative w-full">
      {/* Dropdown Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={() => {
          if (open) setOpen(false);
          else openMenu();
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            openMenu();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        style={{
          background: "var(--input-bg)",
          borderColor: "var(--border)",
          borderRadius: "var(--radius-input)",
        }}
        className={`w-full flex items-center justify-between gap-3 px-3.5 ${compact ? "h-11 rounded-xl" : "py-2.5"} border text-left transition-colors hover:bg-[var(--surface)] hover:border-white/20 ${
          disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
        }`}
      >
        {compact ? (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span
              className={`min-w-0 flex-1 truncate text-sm font-semibold ${selectedModel ? "text-[var(--text)]" : "text-[var(--muted)]"}`}
              title={selectedModel || undefined}
            >
              {currentDisplayName}
            </span>
            {selectedModel && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-neutral-300 font-sans shrink-0">
                {selectedModel.toLowerCase().endsWith(".onnx") ? "ONNX" : "PTH"}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className="w-8 h-8 flex items-center justify-center shrink-0"
              style={{
                background: "var(--accent-soft)",
                borderRadius: "var(--radius-input)",
                color: "var(--text)",
              }}
            >
              <Mic2 size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="text-sm font-semibold truncate"
                  style={{ color: selectedModel ? "var(--text)" : "var(--muted)" }}
                >
                  {currentDisplayName}
                </span>
                {selectedModel && (
                  <span
                    className="text-[10px] px-1.5 py-0.2 rounded shrink-0"
                    style={{ background: "var(--accent-soft)", color: "var(--muted)" }}
                  >
                    {selectedModel.endsWith(".onnx") ? "ONNX" : "PTH"}
                  </span>
                )}
              </div>
              {selectedModel && (
                <p
                  className="text-[11px] truncate m-0 leading-tight mt-0.5"
                  style={{ color: "var(--muted)" }}
                >
                  {modelFolder(selectedModel)} {hasIndexMatch(selectedModel) ? `• ${t("Index paired")}` : ""}
                </p>
              )}
            </div>
          </div>
        )}
        <div className="flex items-center gap-1 shrink-0" style={{ color: "var(--muted)" }}>
          <ChevronDown
            size={16}
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            style={open ? { color: "var(--text)" } : undefined}
          />
        </div>
      </button>

      {menu}
    </div>
  );
}
