// WebSocket URL resolution for realtime voice conversion.
//
// Local page → direct backend URL (browser → Express → engine, no extra hop).
// Tunneled page (any other host) → same-origin path: the tunnel only exposes
// the Next.js server, so Next's rewrite proxy forwards the upgrade to Express,
// which relays it to the engine.
// Pure function (no window access) so it can be unit-tested.

const API_HTTP = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function bareHost(host: string): string {
  // location.host includes the port ("localhost:3000", "[::1]:3000") —
  // strip it before the loopback check.
  const h = host.toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 0 ? h.slice(1, end) : h;
  }
  const i = h.lastIndexOf(":");
  if (i >= 0 && i === h.indexOf(":") && /^\d+$/.test(h.slice(i + 1))) {
    return h.slice(0, i);
  }
  return h;
}

export function resolveRealtimeWsUrl(host: string, protocol: string, path: string): string {
  // `host` (not hostname + port) avoids the empty-port `host:/…` malformed
  // URL when served on default 443/80 ports (Applio-main's main.js has this
  // flaw: `location.hostname + ":" + location.port` with an empty port).
  if (LOOPBACK_HOSTS.has(bareHost(host))) {
    return `${API_HTTP.replace(/^http/, "ws")}${path}`;
  }
  const proto = protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${host}${path}`;
}

export function realtimeWsUrl(path: string): string {
  if (typeof window !== "undefined") {
    return resolveRealtimeWsUrl(window.location.host, window.location.protocol, path);
  }
  return `${API_HTTP.replace(/^http/, "ws")}${path}`;
}
