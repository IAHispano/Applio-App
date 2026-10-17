"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, errMsg } from "@/lib/api";

export interface SetupCheck {
  id: string;
  label: string;
  status: "ok" | "missing" | "warn";
  detail: string;
}

export interface SetupStatus {
  ready: boolean;
  checks: SetupCheck[];
  checkedAt: string;
}

interface SetupContextValue {
  status: SetupStatus | null;
  loading: boolean;
  error: string;
  refresh: (force?: boolean) => Promise<void>;
  isReady: boolean;
}

const SetupContext = createContext<SetupContextValue | null>(null);

export function SetupProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const refresh = useCallback(async (force = false) => {
    const id = ++requestId.current;
    try {
      setLoading(true);
      const res = await apiGet<SetupStatus>(`/api/setup/status${force ? "?refresh=1" : ""}`, { force });
      if (id !== requestId.current) return;
      setStatus(res);
      setError("");
    } catch (e) {
      if (id === requestId.current) setError(errMsg(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      requestId.current++;
    };
  }, [refresh]);

  const isReady = useMemo(() => status?.ready === true, [status?.ready]);

  const value = useMemo(
    () => ({ status, loading, error, refresh, isReady }),
    [status, loading, error, refresh, isReady],
  );

  return <SetupContext.Provider value={value}>{children}</SetupContext.Provider>;
}

export function useSetup(): SetupContextValue {
  const ctx = useContext(SetupContext);
  if (!ctx) {
    throw new Error("useSetup must be used within a SetupProvider");
  }
  return ctx;
}
