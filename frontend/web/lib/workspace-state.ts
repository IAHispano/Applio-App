"use client";

import { usePathname } from "next/navigation";
import { type Dispatch, type SetStateAction, useCallback, useRef, useState } from "react";

// Session-only drafts can contain Files and Sets. Keep them out of disk storage
// and let route components unmount so hidden tabs do not keep polling or audio.
const drafts = new Map<string, unknown>();

export function useWorkspaceState<T>(name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const pathname = usePathname();
  const key = useRef(`${pathname}:${name}`).current;
  const [value, setValue] = useState<T>(() => {
    if (typeof window !== "undefined" && drafts.has(key)) return drafts.get(key) as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  const current = useRef(value);
  const update = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      const next = typeof action === "function" ? (action as (previous: T) => T)(current.current) : action;
      current.current = next;
      drafts.set(key, next);
      setValue(next);
    },
    [key],
  );
  return [value, update];
}

export const workspaceScroll = new Map<string, number>();
