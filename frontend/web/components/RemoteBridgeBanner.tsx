"use client";

import { LogOut, Smartphone } from "lucide-react";
import { useState } from "react";
import { useRemoteBridge } from "@/lib/bridge-mode";
import { useI18n } from "@/lib/i18n";

export default function RemoteBridgeBanner() {
  const { remote, expiresAt } = useRemoteBridge();
  const { t } = useI18n();
  const [error, setError] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);
  if (!remote) return null;
  return (
    <div className="mx-3 sm:mx-5 lg:mx-6 mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <span
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--accent-soft)] shrink-0"
          aria-hidden="true"
        >
          <Smartphone size={16} />
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="m-0 font-medium text-[var(--heading)]">
            {t("Bridge Mode · Processing on your host")}
          </p>
          {expiresAt && (
            <p className="m-0 text-[10px] text-[var(--muted)]">
              {t("Expires")}{" "}
              {new Date(expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        className="ghost px-2.5 py-2 text-[11px] flex items-center gap-1.5 shrink-0"
        disabled={disconnecting}
        aria-busy={disconnecting}
        onClick={async () => {
          setDisconnecting(true);
          setError("");
          try {
            const response = await fetch("/bridge/logout", { method: "POST" });
            if (!response.ok) throw new Error("Disconnect failed");
            try {
              sessionStorage.removeItem("applio:remote-bridge");
            } catch {
              /* optional hint */
            }
            location.replace("/bridge");
          } catch {
            setDisconnecting(false);
            setError(t("Unable to disconnect. Close this browser and revoke the device on your host."));
          }
        }}
      >
        <LogOut size={13} aria-hidden="true" />
        {t(disconnecting ? "Disconnecting…" : "Disconnect")}
      </button>
      {error && (
        <p role="alert" className="w-full m-0 text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
