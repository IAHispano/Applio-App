"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

  const refresh = useCallback(async (force = false) => {
    try {
      setLoading(true);
      const res = await apiGet<SetupStatus>(`/api/setup/status${force ? "?refresh=1" : ""}`);
      setStatus(res);
      setError("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
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
