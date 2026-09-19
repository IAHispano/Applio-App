"use client";

import { Check, ChevronDown, Mic2, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../lib/i18n";

export interface ModelDropdownProps {
  models: string[];
  selectedModel: string;
  onSelect: (modelPath: string) => void;
  onRefresh?: () => void;
  onUnload?: () => void;
  indexes?: string[];
  disabled?: boolean;
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
  onUnload,
  indexes = [],
  disabled = false,
}: ModelDropdownProps) {
  const { t } = useI18n();
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
    const selected = filteredModels.findIndex((m) => m === selectedModel);
    setHighlighted(selected >= 0 ? selected : filteredModels.length > 0 ? 0 : -1);
  }, [open, search, selectedModel, filteredModels]);

  // Keep the highlighted option visible while navigating.
  useEffect(() => {
    if (!open || highlighted < 0) return;
    itemRefs.current.get(highlighted)?.scrollIntoView({ block: "nearest" });
  }, [open, highlighted]);

  useEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updatePosition();
    setTimeout(() => searchInputRef.current?.focus(), 50);

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveHighlight(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveHighlight(-1);
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        setHighlighted(filteredModels.length > 0 ? 0 : -1);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        setHighlighted(filteredModels.length > 0 ? filteredModels.length - 1 : -1);
        return;
      }
      if (e.key === "Enter") {
        // Let focused buttons (options, Unload, Refresh) handle Enter natively.
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "BUTTON" || tag === "A") return;
        e.preventDefault();
        chooseModel(filteredModels[highlighted] ?? filteredModels[0]);
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
  }, [open, updatePosition, moveHighlight, chooseModel, filteredModels, highlighted]);

  const currentDisplayName = selectedModel ? modelDisplayName(selectedModel) : t("Select a voice model…");

  const menu =
    open && mounted && menuPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-activedescendant={highlighted >= 0 ? `model-option-${highlighted}` : undefined}
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
            className="shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 flex flex-col max-h-[min(24rem,calc(100vh-120px))]"
          >
            <div
              className="p-2 flex items-center gap-2 shrink-0"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <Search size={14} className="ml-1 shrink-0" style={{ color: "var(--muted)" }} />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("Search models…")}
                className="w-full bg-transparent text-xs border-none outline-none py-1 focus:ring-0"
                style={{ color: "var(--text)" }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="p-1 rounded transition-colors hover:text-white"
                  style={{ color: "var(--muted)" }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Model Items List */}
            <div className="max-h-64 overflow-y-auto py-1 grow">
              {filteredModels.length === 0 ? (
                <div className="p-4 text-center">
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
                      id={`model-option-${i}`}
                      ref={(el) => {
                        itemRefs.current.set(i, el);
                      }}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setHighlighted(i)}
                      onClick={() => chooseModel(m)}
                      className={`menu-option w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left cursor-pointer border-0 rounded-none bg-transparent ${
                        isSelected ? "text-white font-medium" : "text-neutral-400 hover:text-neutral-200"
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
                            className={`text-xs truncate ${isSelected ? "font-semibold text-white" : "font-medium"}`}
                          >
                            {modelDisplayName(m)}
                          </span>
                          <span className="text-[10px] font-mono text-neutral-500 shrink-0">
                            {m.endsWith(".onnx") ? "ONNX" : "PTH"}
                          </span>
                        </div>
                        <p className="text-[10px] truncate m-0 leading-tight mt-0.5 text-neutral-500">
                          {m} {hasIndex ? `• ${t("Index paired")}` : ""}
                        </p>
                      </div>

                      {isSelected && <Check size={14} className="text-white shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>

            {/* Actions Footer */}
            <div
              className="p-2 flex items-center justify-between gap-2 text-xs shrink-0"
              style={{ borderTop: "1px solid var(--border)", background: "var(--input-bg)" }}
            >
              <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                {models.length} {t("models available")}
              </span>
              <div className="flex items-center gap-2">
                {selectedModel && onUnload && (
                  <button
                    type="button"
                    onClick={() => {
                      onUnload();
                      setOpen(false);
                    }}
                    className="text-xs transition-colors hover:text-red-400"
                    style={{ color: "var(--muted)" }}
                  >
                    {t("Unload")}
                  </button>
                )}
                {onRefresh && (
                  <button
                    type="button"
                    onClick={() => {
                      onRefresh();
                    }}
                    className="flex items-center gap-1 text-xs transition-colors hover:text-white"
                    style={{ color: "var(--button-ghost-text)" }}
                  >
                    <RefreshCw size={11} />
                    <span>{t("Refresh")}</span>
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative w-full">
      {/* Dropdown Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          background: "var(--input-bg)",
          borderColor: "var(--border)",
          borderRadius: "var(--radius-input)",
        }}
        className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 border text-left transition-colors hover:border-white/20 ${
          disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
        }`}
      >
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
              <p className="text-[11px] truncate m-0 leading-tight mt-0.5" style={{ color: "var(--muted)" }}>
                {modelFolder(selectedModel)} {hasIndexMatch(selectedModel) ? `• ${t("Index paired")}` : ""}
              </p>
            )}
          </div>
        </div>

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
