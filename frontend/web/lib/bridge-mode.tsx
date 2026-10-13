"use client";

import { createContext, useContext, useEffect, useState } from "react";

export interface BridgeState {
  status: "stopped" | "starting" | "sharing" | "error";
  message?: string;
  link?: string;
  inviteExpiresAt?: number;
  devices: { id: string; name: string; code: string; status: "pending" | "approved"; expiresAt: number }[];
}

export interface DesktopBridgeMode {
  getStatus: () => Promise<BridgeState>;
  start: () => Promise<BridgeState>;
  stop: () => Promise<BridgeState>;
  newInvite: () => Promise<BridgeState>;
  copyInvite: () => Promise<void>;
  approve: (id: string) => Promise<BridgeState>;
  revoke: (id: string) => Promise<BridgeState>;
}

export function desktopBridgeMode(): DesktopBridgeMode | undefined {
  return (window as unknown as { applio?: { bridgeMode?: DesktopBridgeMode } }).applio?.bridgeMode;
}

export const REMOTE_HOST_ROUTES = new Set([
  "/",
  "/settings",
  "/setup",
  "/models",
  "/train",
  "/tensorboard",
  "/realtime",
  "/voice-blender",
  "/report",
]);
const RemoteContext = createContext<{ remote: boolean; expiresAt?: number }>({ remote: false });

export function RemoteBridgeProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<{ remote: boolean; expiresAt?: number }>({ remote: false });
  useEffect(() => {
    if (desktopBridgeMode()) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    let remote = false;
    try {
      remote = sessionStorage.getItem("applio:remote-bridge") === "1";
    } catch {
      /* optional hint */
    }
    if (remote) setSession({ remote: true });
    const check = async () => {
      try {
        const response = await fetch("/bridge/session", { cache: "no-store", signal: controller.signal });
        if (response.headers.get("content-type")?.includes("application/json")) {
          const data = await response.json();
          if (disposed) return;
          if (data.status === "approved") {
            remote = true;
            try {
              sessionStorage.setItem("applio:remote-bridge", "1");
            } catch {
              /* optional hint */
            }
            setSession({ remote: true, expiresAt: data.expiresAt });
          } else if (remote && response.status === 401) {
            location.replace("/bridge");
            return;
          }
        }
      } catch {
        /* retry when the host reconnects */
      }
      if (!disposed && remote) timer = setTimeout(check, 15000);
    };
    void check();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);
  return <RemoteContext.Provider value={session}>{children}</RemoteContext.Provider>;
}

export const useRemoteBridge = () => useContext(RemoteContext);
