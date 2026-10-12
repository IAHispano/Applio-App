"use client";

import { useEffect, useSyncExternalStore } from "react";
import { apiGet, apiSend, errMsg } from "@/lib/api";

type Values = Record<string, string | number | boolean>;
type Snapshot = { presets: Record<string, Values>; loaded: boolean; error: string };
let snapshot: Snapshot = { presets: {}, loaded: false, error: "" };
const listeners = new Set<() => void>();
const touched = new Map<string, Values>();
let hydrated = false;
let loading: Promise<void> | undefined;
const pendingSaves = new Map<string, { scope: string; model: string }>();
let saving = false;
const serverSnapshot = snapshot;
export const modelPresetKey = (scope: string, model: string) => `${scope}:${model.replace(/\\/g, "/")}`;
function publish(next: Snapshot) {
  snapshot = next;
  for (const notify of listeners) notify();
}
export function loadModelPresets(): Promise<void> {
  if (!loading)
    loading = apiGet<{ presets: Record<string, Values> }>("/api/settings/model-presets", { ttlMs: 0 })
      .then(({ presets }) => {
        hydrated = true;
        for (const [key, values] of touched) presets[key] = { ...presets[key], ...values };
        publish({ presets, loaded: true, error: "" });
        if (pendingSaves.size) void flushPresetSaves();
      })
      .catch((error) => {
        loading = undefined;
        publish({ ...snapshot, loaded: true, error: errMsg(error) });
      });
  return loading;
}
export function getModelPreset(scope: string, model: string): Values | undefined {
  return snapshot.presets[modelPresetKey(scope, model)];
}
export function saveModelPreset(scope: string, model: string, patch: Values): void {
  if (!model) return;
  const key = modelPresetKey(scope, model);
  const current = snapshot.presets[key];
  if (
    !snapshot.error &&
    current &&
    Object.entries(patch).every(([name, value]) => Object.is(current[name], value))
  )
    return;
  touched.set(key, { ...touched.get(key), ...patch });
  publish({ ...snapshot, presets: { ...snapshot.presets, [key]: { ...snapshot.presets[key], ...patch } } });
  pendingSaves.set(key, { scope, model });
  void flushPresetSaves();
}
async function flushPresetSaves(): Promise<void> {
  if (saving) return;
  saving = true;
  try {
    await loadModelPresets();
    if (!hydrated) throw new Error(snapshot.error);
    while (pendingSaves.size) {
      const [key, identity] = pendingSaves.entries().next().value as [
        string,
        { scope: string; model: string },
      ];
      pendingSaves.delete(key);
      const values = snapshot.presets[key];
      try {
        await apiSend("/api/settings/model-presets", "PUT", { ...identity, values });
      } catch (error) {
        // Keep the failed model pending, including any edits made in flight.
        pendingSaves.set(key, identity);
        throw error;
      }
    }
    if (snapshot.error) publish({ ...snapshot, error: "" });
  } catch (error) {
    publish({ ...snapshot, error: errMsg(error) });
  } finally {
    saving = false;
  }
}
export function useModelPresets() {
  const state = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    () => snapshot,
    () => serverSnapshot,
  );
  useEffect(() => {
    void loadModelPresets();
  }, []);
  return state;
}
