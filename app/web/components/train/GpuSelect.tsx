"use client";

import { Check, ChevronDown, Cpu } from "lucide-react";
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../lib/i18n";

export interface GpuDevice {
  id: string; // "0", "1", ...
  name: string; // "GPU 0: NVIDIA GeForce RTX 3060 Ti (8 GB)"
  mem?: number | string;
}

export interface GpuSelectProps {
  id?: string;
  value: string; // "0", "1", "0-1", or "-"
  onChange: (val: string) => void;
  devices: GpuDevice[];
  disabled?: boolean;
  className?: string;
}

interface MenuPosition {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
}

export default function GpuSelect({
  id: propId,
  value,
  onChange,
  devices = [],
  disabled = false,
  className = "",
}: GpuSelectProps) {
  const { t } = useI18n();
  const generatedId = useId();
  const id = propId || `gpu-select-${generatedId}`;

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isCpu = value === "-" || !value;

  const selectedIds = useMemo(() => {
    if (isCpu) return [];
    return value
      .split("-")
      .map((s) => s.trim())
      .filter(Boolean);
  }, [value, isCpu]);

  // Floating menu position calculation
  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const gap = 4;
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
        top: Math.min(rect.bottom + gap, window.innerHeight - 80),
      });
    }
  }, []);

  const handleOpen = () => {
    if (disabled) return;
    updatePosition();
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
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
      setOpen(false);
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

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    } else if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      if (!open) {
        e.preventDefault();
        handleOpen();
      }
    }
  };

  const toggleGpu = (gpuId: string) => {
    if (disabled) return;
    let next: string[];
    if (selectedIds.includes(gpuId)) {
      next = selectedIds.filter((x) => x !== gpuId);
    } else {
      next = [...selectedIds, gpuId];
    }

    // Sort numerically
    next.sort((a, b) => {
      const na = Number.parseInt(a, 10);
      const nb = Number.parseInt(b, 10);
      if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b);
      return na - nb;
    });

    if (next.length === 0) {
      onChange("-");
    } else {
      onChange(next.join("-"));
    }
  };

  const selectCpu = () => {
    if (disabled) return;
    onChange("-");
  };

  const selectAllGpus = () => {
    if (disabled || devices.length === 0) return;
    const all = devices
      .map((d) => d.id)
      .sort((a, b) => {
        const na = Number.parseInt(a, 10);
        const nb = Number.parseInt(b, 10);
        return na - nb;
      })
      .join("-");
    onChange(all);
  };

  // Label to show inside trigger button
  const displayLabel = useMemo(() => {
    if (isCpu || devices.length === 0) {
      return t("CPU");
    }
    if (selectedIds.length === 1) {
      const match = devices.find((d) => d.id === selectedIds[0]);
      return match ? match.name : `GPU ${selectedIds[0]}`;
    }
    if (selectedIds.length === devices.length && devices.length > 1) {
      return `${t("All GPUs")} (${value})`;
    }
    if (selectedIds.length > 1) {
      return `${selectedIds.length} ${t("GPUs")} (${value})`;
    }
    return t("Select GPU…");
  }, [isCpu, devices, selectedIds, value, t]);

  const badgeLabel = useMemo(() => {
    if (isCpu) return undefined;
    if (selectedIds.length > 1) {
      return `${selectedIds.length}x GPU`;
    }
    return undefined;
  }, [isCpu, selectedIds]);

  return (
    <div className={`relative inline-block w-full text-left ${className}`}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => (open ? handleClose() : handleOpen())}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={displayLabel}
        className={`w-full flex items-center justify-between gap-2 bg-[var(--input-bg)] border transition-all select-none cursor-pointer text-left h-10 px-3 text-xs sm:text-sm rounded-xl ${
          open ? "border-[var(--border)]" : "border-[var(--border)] hover:border-white/20"
        } ${disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : "hover:bg-white/[0.03]"}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Cpu size={14} className="text-neutral-400 shrink-0" />
          <span className="truncate text-[var(--text)] font-semibold">{displayLabel}</span>
        </div>

        {badgeLabel && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-neutral-300 font-mono shrink-0">
            {badgeLabel}
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

      {/* Floating Dropdown Menu in Portal */}
      {mounted &&
        open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-multiselectable={devices.length > 1}
            aria-label={t("GPU selection")}
            style={{
              position: "fixed",
              left: menuPos.left,
              width: menuPos.width,
              ...(menuPos.top !== undefined ? { top: menuPos.top } : {}),
              ...(menuPos.bottom !== undefined ? { bottom: menuPos.bottom } : {}),
            }}
            className="z-[99999] bg-[#121212] border border-white/15 rounded-xl shadow-2xl overflow-hidden backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 select-none"
          >
            {/* Header when multiple GPUs available */}
            {devices.length > 1 && (
              <div className="flex items-center justify-between px-3.5 py-2 border-b border-white/10 text-[11px] text-neutral-400">
                <span className="font-semibold uppercase tracking-wider text-[10px] text-neutral-500">
                  {t("Select GPUs")}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllGpus}
                    className="text-[11px] text-neutral-400 hover:text-white transition-colors bg-transparent border-0 p-0 cursor-pointer"
                  >
                    {t("Select all")}
                  </button>
                  <span className="text-white/20">|</span>
                  <button
                    type="button"
                    onClick={selectCpu}
                    className="text-[11px] text-neutral-400 hover:text-white transition-colors bg-transparent border-0 p-0 cursor-pointer"
                  >
                    {t("CPU only")}
                  </button>
                </div>
              </div>
            )}

            {/* GPU Device Options */}
            <div className="max-h-64 overflow-y-auto scrollbar-thin py-1">
              {devices.length === 0 ? (
                <div className="py-2.5 px-3.5 text-xs text-neutral-400 italic">
                  {t("No CUDA GPU detected")}
                </div>
              ) : (
                devices.map((device) => {
                  const isSelected = selectedIds.includes(device.id);

                  return (
                    <button
                      key={device.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => toggleGpu(device.id)}
                      className={`menu-option w-full px-3.5 py-2 text-xs flex items-center justify-between text-left cursor-pointer border-0 rounded-none bg-transparent ${
                        isSelected ? "text-white font-bold" : "text-neutral-400 hover:text-neutral-200"
                      }`}
                    >
                      <div className="min-w-0 flex-1 flex flex-col">
                        <span className="truncate">{device.name}</span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {devices.length > 1 && (
                          <span className="text-[10px] font-mono text-neutral-500">
                            ID: {device.id}
                          </span>
                        )}
                        {isSelected && <Check size={14} className="text-white shrink-0" />}
                      </div>
                    </button>
                  );
                })
              )}

              {/* CPU Option */}
              <div className="border-t border-white/10 mt-1 pt-1">
                <button
                  type="button"
                  role="option"
                  aria-selected={isCpu}
                  onClick={selectCpu}
                  className={`menu-option w-full px-3.5 py-2 text-xs flex items-center justify-between text-left cursor-pointer border-0 rounded-none bg-transparent ${
                    isCpu ? "text-white font-bold" : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  <div className="min-w-0 flex-1 flex flex-col">
                    <span className="truncate">{t("CPU")}</span>
                    <span className="text-[10px] truncate text-neutral-500">
                      {t("CPU mode (no GPU acceleration)")}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {isCpu && <Check size={14} className="text-white shrink-0" />}
                  </div>
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
