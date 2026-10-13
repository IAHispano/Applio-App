"use client";

import {
  AlertCircle,
  Check,
  Clock3,
  Copy,
  Link2,
  LoaderCircle,
  Monitor,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Unplug,
  Upload,
  X,
} from "lucide-react";
import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, Disclosure } from "@/components/ui";
import { errMsg } from "@/lib/api";
import { type BridgeState, type DesktopBridgeMode, desktopBridgeMode } from "@/lib/bridge-mode";
import { useI18n } from "@/lib/i18n";

export default function BridgeModeCard() {
  const { t } = useI18n();
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<BridgeState>({ status: "stopped", devices: [] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const bridge = desktopBridgeMode();
    if (!bridge) return;
    setAvailable(true);
    let disposed = false;
    const refresh = async () => {
      try {
        const status = await bridge.getStatus();
        if (!disposed) {
          setState(status);
          setNow(Date.now());
        }
      } catch (e) {
        if (!disposed) setError(errMsg(e));
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  const link = state.link && (state.inviteExpiresAt || 0) > now ? state.link : "";
  useEffect(() => {
    let disposed = false;
    setQr("");
    setCopied(false);
    if (link)
      void QRCode.toDataURL(link, { width: 240, margin: 3, errorCorrectionLevel: "M" })
        .then((value) => {
          if (!disposed) setQr(value);
        })
        .catch((e) => {
          if (!disposed) setError(errMsg(e));
        });
    return () => {
      disposed = true;
    };
  }, [link]);

  const run = async (action: (bridge: DesktopBridgeMode) => Promise<BridgeState>) => {
    setBusy(true);
    setError("");
    try {
      const bridge = desktopBridgeMode();
      if (!bridge) throw new Error("Bridge Mode is unavailable.");
      setState(await action(bridge));
      setNow(Date.now());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!available) return null;
  const sharing = state.status === "sharing";
  const starting = state.status === "starting";
  const pending = state.devices.filter((device) => device.status === "pending");
  const connected = state.devices.filter((device) => device.status === "approved");
  const minutesLeft = Math.max(0, Math.ceil(((state.inviteExpiresAt || 0) - now) / 60000));
  const time = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <Card id="bridge-mode" className="bridge-card">
      <CardHeader
        icon={<Smartphone size={19} />}
        title={t("Bridge Mode")}
        description={t("Your Applio, on any device. Processing stays on this computer.")}
        action={
          <div className="flex items-center gap-3 flex-wrap">
            <Badge
              variant={
                sharing ? "success" : starting ? "info" : state.status === "error" ? "danger" : "neutral"
              }
              dot
            >
              {t(
                sharing
                  ? "Sharing"
                  : starting
                    ? "Connecting…"
                    : state.status === "error"
                      ? "Connection failed"
                      : "Off",
              )}
            </Badge>
            {(sharing || starting) && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Unplug size={14} />}
                onClick={() => run((bridge) => bridge.stop())}
              >
                {t(starting ? "Cancel" : "Stop sharing")}
              </Button>
            )}
          </div>
        }
      />

      {(error || state.status === "error") && (
        <div role="alert" className="bridge-alert">
          <AlertCircle size={17} className="shrink-0" />
          <span>{error || state.message}</span>
        </div>
      )}

      {!sharing && (
        <div className="bridge-intro">
          <div className="bridge-device-art" aria-hidden="true">
            <span className="bridge-art-host">
              <Monitor size={36} strokeWidth={1.4} />
            </span>
            <span className="bridge-art-line" />
            <span className="bridge-art-phone">
              <Smartphone size={25} strokeWidth={1.5} />
            </span>
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <h3 className="text-base font-semibold text-[var(--heading)] m-0">
              {t(starting ? "Opening your private connection" : "Take Applio with you")}
            </h3>
            <p className="field-help m-0 max-w-xl">
              {t(
                "Scan a QR code on your phone or open a private link on another computer. No installation or shared network needed.",
              )}
            </p>
            {starting ? (
              <div role="status" className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <LoaderCircle size={15} className="animate-spin shrink-0" />
                <span>{t(state.message || "Connecting…")}</span>
              </div>
            ) : (
              <Button
                size="sm"
                icon={<Link2 size={15} />}
                loading={busy}
                onClick={() => {
                  setState({ status: "starting", devices: [] });
                  void run((bridge) => bridge.start());
                }}
              >
                {t("Start sharing")}
              </Button>
            )}
          </div>
        </div>
      )}

      {sharing && (
        <div className="bridge-invite-grid">
          <div className="bridge-qr-panel">
            <div className="bridge-qr-frame">
              {link && qr ? (
                <Image
                  unoptimized
                  src={qr}
                  width={208}
                  height={208}
                  alt={t("Scan to request access to Applio")}
                  className="bridge-qr-image"
                />
              ) : link ? (
                <LoaderCircle
                  size={24}
                  className="animate-spin text-neutral-500"
                  aria-label={t("Generating QR code")}
                />
              ) : (
                <QrCode size={56} strokeWidth={1} className="text-neutral-500" aria-hidden="true" />
              )}
            </div>
            <p className="text-sm font-semibold m-0">
              {t(link ? "Scan with your phone" : "Invitation expired")}
            </p>
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <Clock3 size={13} />
              {link
                ? t("Expires in {minutes} min", { minutes: minutesLeft })
                : t("Connected devices stay connected")}
            </span>
          </div>
          <div className="bridge-invite-content">
            <div className="space-y-1.5">
              <span className="bridge-eyebrow">{t("Connect another device")}</span>
              <h3 className="text-lg font-semibold m-0 text-[var(--heading)]">
                {t("Open, approve, and you're in.")}
              </h3>
            </div>
            <ol className="bridge-steps">
              {[
                t("Scan the QR code or open the link."),
                t("Name your device and request access."),
                t("Check the matching code and approve below."),
              ].map((step, index) => (
                <li key={step}>
                  <span aria-hidden="true">{index + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
            {link ? (
              <div className="space-y-2">
                <label htmlFor="bridge-link" className="text-xs font-medium text-[var(--muted)]">
                  {t("Private invitation link")}
                </label>
                <div className="bridge-link-row">
                  <input
                    id="bridge-link"
                    type="text"
                    readOnly
                    value={link}
                    onFocus={(e) => e.target.select()}
                    className="min-w-0 flex-1 text-xs"
                  />
                  <Button
                    size="sm"
                    icon={copied ? <Check size={15} /> : <Copy size={15} />}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(link);
                        setCopied(true);
                      } catch {
                        setError(t("Select and copy the link manually."));
                      }
                    }}
                  >
                    {t(copied ? "Copied" : "Copy link")}
                  </Button>
                </div>
              </div>
            ) : (
              <p role="status" className="field-help m-0">
                {t("Create a fresh invitation to connect another device.")}
              </p>
            )}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <ShieldCheck size={14} />
                {t("Only devices you approve can connect")}
              </span>
              <Button
                size="xs"
                variant="ghost"
                disabled={busy}
                icon={<RefreshCw size={13} />}
                onClick={() => run((bridge) => bridge.newInvite())}
              >
                {t("New invitation")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {sharing && (
        <div className="space-y-4">
          {pending.length > 0 && (
            <section className="bridge-requests" aria-labelledby="bridge-requests-title">
              <div className="flex items-center justify-between gap-2">
                <h3 id="bridge-requests-title" className="text-sm font-semibold m-0 flex items-center gap-2">
                  <ShieldCheck size={16} />
                  {t("Waiting for approval")}
                </h3>
                <Badge variant="warning">{pending.length}</Badge>
              </div>
              <p className="field-help m-0">
                {t("Match this code with the one on your other device. Only approve your own browser.")}
              </p>
              {pending.map((device) => (
                <div key={device.id} className="bridge-request-row">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold m-0 break-words">{device.name}</p>
                    <p className="field-help m-0">
                      {t("Request expires at")} {time(device.expiresAt)}
                    </p>
                  </div>
                  <code className="bridge-match-code">
                    {device.code.slice(0, 4)}
                    <span aria-hidden="true"> </span>
                    {device.code.slice(4)}
                  </code>
                  <div className="bridge-device-actions">
                    <Button
                      size="sm"
                      disabled={busy}
                      icon={<Check size={15} />}
                      onClick={() => run((bridge) => bridge.approve(device.id))}
                    >
                      {t("Approve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      icon={<X size={15} />}
                      onClick={() => run((bridge) => bridge.revoke(device.id))}
                    >
                      {t("Reject")}
                    </Button>
                  </div>
                </div>
              ))}
            </section>
          )}
          <section className="space-y-3" aria-labelledby="bridge-devices-title">
            <h3 id="bridge-devices-title" className="text-sm font-semibold m-0 flex items-center gap-2">
              {t("Connected devices")}
              <Badge variant="neutral">{connected.length}</Badge>
            </h3>
            {connected.length === 0 ? (
              <div className="bridge-empty-devices">
                <Smartphone size={20} strokeWidth={1.5} />
                <span>{t("Your approved devices will appear here.")}</span>
              </div>
            ) : (
              connected.map((device) => (
                <div key={device.id} className="bridge-connected-row">
                  <span className="bridge-connected-icon" aria-hidden="true">
                    <Smartphone size={19} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium m-0 break-words">{device.name}</p>
                    <p className="field-help m-0">
                      {t("Connected until")} {time(device.expiresAt)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    icon={<Unplug size={14} />}
                    onClick={() => run((bridge) => bridge.revoke(device.id))}
                  >
                    {t("Disconnect")}
                  </Button>
                </div>
              ))
            )}
          </section>
        </div>
      )}

      <div className="bridge-footer">
        <span>
          <Monitor size={13} />
          {t("Keep this computer awake")}
        </span>
        <span>
          <Clock3 size={13} />
          {t("8-hour sessions")}
        </span>
        <span>
          <Upload size={13} />
          {t("100 MB uploads")}
        </span>
      </div>
      <Disclosure
        title={t("Privacy & connection details")}
        icon={<ShieldCheck size={14} />}
        summaryClassName="!text-xs !font-medium"
        bodyClassName="!space-y-2"
      >
        <p className="field-help m-0">
          {t(
            "This experimental connection uses Cloudflare's HTTPS relay. Traffic passes through Cloudflare; it is not end-to-end encrypted between your devices.",
          )}
        </p>
        <p className="field-help m-0">
          {t(
            "The first start downloads a verified helper. Temporary tunnels have no uptime guarantee. Invitations expire after ten minutes; starting a new invitation replaces the old link.",
          )}
        </p>
        <p className="field-help m-0">
          {t("On a borrowed computer, disconnect before leaving. Stop sharing ends access for every device.")}
        </p>
      </Disclosure>
    </Card>
  );
}
