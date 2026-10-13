import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { type BridgePairingLanguage, bridgePairingPage } from "./bridge-page";
import { type BridgeDevice, BridgeSessions } from "./bridge-sessions";

const COOKIE = "__Host-applio_bridge";
export const MAX_BRIDGE_UPLOAD = 100 * 1024 * 1024;
const SAFE_METHODS = new Set(["GET", "HEAD"]);
const HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

/** Explicit remote capability list: install, plugins, training and host configuration stay local. */
export function bridgeApiAllowed(method: string, path: string): boolean {
  if (path.endsWith("/events")) return false; // Quick Tunnels do not carry SSE; clients use polling.
  if (SAFE_METHODS.has(method)) {
    return (
      /^\/api\/(models(?:\/|$)|jobs(?:\/|$)|tts\/voices$|uvr\/models$|audio\/raw$|health$|setup\/status$|train\/gpus$)/.test(
        path,
      ) ||
      /^\/api\/settings(?:\/(?:language|languages|theme|themes|model-presets|version))?$/.test(path) ||
      /^\/api\/inference\/batch\/[a-zA-Z0-9_-]+\/outputs\/\d+$/.test(path)
    );
  }
  if (method === "PUT") return path === "/api/settings/model-presets";
  if (method !== "POST") return false;
  return (
    [
      "/api/inference",
      "/api/inference/batch",
      "/api/inference/batch/preview",
      "/api/tts",
      "/api/uvr/separate",
      "/api/extra/analyze",
      "/api/extra/f0",
      "/api/extra/model-info",
      "/api/models/inspect",
      "/api/models/preload",
      "/api/audio/youtube",
    ].includes(path) || /^\/api\/jobs\/[a-zA-Z0-9_-]+\/stop$/.test(path)
  );
}

export class BridgeGateway {
  readonly sessions: BridgeSessions;
  private server?: http.Server;
  private origin?: string;
  private sockets = new Set<Socket>();
  private active = new Map<string, Set<() => void>>();
  private expiryTimer?: ReturnType<typeof setInterval>;
  private pairAttempts = 0;
  private pairWindow = 0;

  constructor(
    private readonly webPort: number,
    private readonly apiPort: number,
    private readonly onRequest: (device: BridgeDevice) => void = () => {},
    private readonly pairingFont?: Buffer,
    private readonly pairingLanguage?: () => BridgePairingLanguage,
  ) {
    this.sessions = new BridgeSessions(Date.now, (id) => {
      for (const cancel of this.active.get(id) || []) cancel();
      this.active.delete(id);
    });
  }

  setOrigin(origin: string) {
    this.origin = new URL(origin).origin;
  }

  async listen(): Promise<number> {
    const server = http.createServer((req, res) => {
      void this.handle(req, res).catch(() => this.json(res, 500, { error: "Bridge request failed" }));
    });
    this.server = server;
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
    server.on("upgrade", (_req, socket) => socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    this.expiryTimer = setInterval(() => this.sessions.list(), 5000);
    this.expiryTimer.unref();
    return (server.address() as { port: number }).port;
  }

  stop() {
    clearInterval(this.expiryTimer);
    this.sessions.clear();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.server?.close();
    this.server = undefined;
    this.origin = undefined;
  }

  private json(res: ServerResponse, status: number, body: unknown) {
    if (res.headersSent || res.destroyed) return;
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  }

  private credential(req: IncomingMessage) {
    return req.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    if (!this.origin || req.headers.host !== new URL(this.origin).host) {
      return this.json(res, 421, { error: "Bridge is not ready" });
    }
    const rawPath = (req.url || "/").split("?")[0];
    // Reject ambiguous encodings before either upstream can interpret them differently.
    const decoded = (() => {
      try {
        return decodeURIComponent(rawPath);
      } catch {
        return "";
      }
    })();
    if (!decoded || decoded !== rawPath || /\\|\/\/|(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath)) {
      // Static/output names may contain escaped spaces or Unicode; only accept these
      // outside routing segments, after an unambiguous static prefix.
      if (
        !/^\/(?:outputs|assets|_next\/static)\//.test(rawPath) ||
        !decoded ||
        /%|\\|\/\/|(?:^|\/)\.{1,2}(?:\/|$)/.test(decoded) ||
        /%(?:2f|5c)/i.test(rawPath)
      ) {
        return this.json(res, 400, { error: "Invalid bridge path" });
      }
    }
    const url = new URL(req.url || "/", this.origin);
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    const method = req.method || "GET";
    if (!SAFE_METHODS.has(method) && req.headers.origin !== this.origin) {
      return this.json(res, 403, { error: "Cross-origin requests are not allowed" });
    }
    const device = this.sessions.find(this.credential(req));
    // Only the bundled interface font is public before approval, never app assets.
    if (pathname === "/bridge/syne.ttf" && SAFE_METHODS.has(method)) {
      if (!this.pairingFont) return this.json(res, 404, { error: "Font unavailable" });
      res.writeHead(200, {
        "Content-Type": "font/ttf",
        "Content-Length": this.pairingFont.length,
        "Cache-Control": "public, max-age=86400",
      });
      res.end(method === "HEAD" ? undefined : this.pairingFont);
      return;
    }
    if (pathname === "/bridge" && method === "GET") {
      const { html, nonce } = bridgePairingPage(this.pairingLanguage?.());
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
      );
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (pathname === "/bridge/session" && method === "GET") {
      return this.json(
        res,
        device ? 200 : 401,
        device
          ? { status: device.status, code: device.code, expiresAt: device.expiresAt }
          : { status: "expired" },
      );
    }
    if (pathname === "/bridge/logout" && method === "POST") {
      // Complete this response before closing any other in-flight requests for the device.
      res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
      this.json(res, 200, { ok: true });
      if (device) this.sessions.revoke(device.id);
      return;
    }
    if (pathname === "/bridge/pair" && method === "POST") {
      if (Date.now() - this.pairWindow > 60000) {
        this.pairWindow = Date.now();
        this.pairAttempts = 0;
      }
      if (++this.pairAttempts > 20)
        return this.json(res, 429, { error: "Too many requests. Try again in a minute." });
      if (!req.headers["content-type"]?.startsWith("application/json"))
        return this.json(res, 415, { error: "Expected JSON" });
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 4096) return this.json(res, 413, { error: "Request too large" });
        chunks.push(chunk);
      }
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (typeof body.invite !== "string" || body.invite.length > 128 || typeof body.name !== "string")
          throw new Error("Invalid invitation");
        if (device?.status === "approved")
          return this.json(res, 409, { error: "This browser is already connected" });
        if (device) this.sessions.revoke(device.id);
        const request = this.sessions.request(body.invite, body.name);
        res.setHeader(
          "Set-Cookie",
          `${COOKIE}=${request.credential}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${8 * 60 * 60}`,
        );
        this.json(res, 202, { status: "pending" });
        this.onRequest(request.device);
      } catch (error) {
        this.json(res, 400, { error: (error as Error).message });
      }
      return;
    }
    if (pathname.startsWith("/bridge")) return this.json(res, 404, { error: "Unknown bridge endpoint" });
    if (device?.status !== "approved") {
      if (method === "GET" && req.headers.accept?.includes("text/html") && !pathname.startsWith("/api/")) {
        res.writeHead(303, { Location: "/bridge" });
        res.end();
        return;
      }
      return this.json(res, 401, { error: "Approve this device on the host computer first" });
    }
    const api = /^\/api(?:\/|$)/i.test(pathname);
    if ((api && !bridgeApiAllowed(method, pathname)) || (!api && !SAFE_METHODS.has(method))) {
      return this.json(res, 403, { error: "This feature is available on the host computer only" });
    }
    if (Number(req.headers["content-length"] || 0) > MAX_BRIDGE_UPLOAD) {
      return this.json(res, 413, { error: "Bridge uploads are limited to 100 MB" });
    }
    this.proxy(
      req,
      res,
      device.id,
      api || /^\/(outputs|assets)(\/|$)/.test(pathname) ? this.apiPort : this.webPort,
    );
  }

  private proxy(req: IncomingMessage, res: ServerResponse, deviceId: string, port: number) {
    const headers = { ...req.headers };
    for (const name of [
      ...HOP_HEADERS,
      ...String(headers.connection || "")
        .toLowerCase()
        .split(/\s*,\s*/),
    ])
      delete headers[name];
    for (const name of Object.keys(headers)) {
      if (
        name.startsWith("x-forwarded-") ||
        name.startsWith("cf-") ||
        ["cookie", "authorization", "forwarded"].includes(name)
      )
        delete headers[name];
    }
    headers.host = `127.0.0.1:${port}`;
    delete headers.origin;
    let transferred = 0;
    const upstream = http.request(
      { hostname: "127.0.0.1", port, method: req.method, path: req.url, headers },
      (response) => {
        const outgoing: http.OutgoingHttpHeaders = {
          ...response.headers,
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "x-frame-options": "DENY",
        };
        for (const name of [
          ...HOP_HEADERS,
          "set-cookie",
          ...String(response.headers.connection || "")
            .toLowerCase()
            .split(/\s*,\s*/),
        ])
          delete outgoing[name];
        for (const name of Object.keys(outgoing))
          if (name.startsWith("access-control-")) delete outgoing[name];
        if (res.destroyed || res.headersSent) {
          response.destroy();
          return;
        }
        res.writeHead(response.statusCode || 502, outgoing);
        response.on("error", () => res.destroy());
        response.pipe(res);
      },
    );
    const cancel = () => {
      upstream.destroy();
      res.destroy();
    };
    const requests = this.active.get(deviceId) || new Set<() => void>();
    requests.add(cancel);
    this.active.set(deviceId, requests);
    res.once("close", () => {
      upstream.destroy();
      requests.delete(cancel);
      if (!requests.size) this.active.delete(deviceId);
    });
    upstream.on("error", () => {
      if (res.headersSent) res.destroy();
      else this.json(res, 502, { error: "The host service is unavailable. Keep Applio running." });
    });
    upstream.setTimeout(180000, () => upstream.destroy(new Error("Host request timed out")));
    req.on("aborted", () => upstream.destroy());
    req.on("error", () => upstream.destroy());
    req.on("data", (chunk: Buffer) => {
      transferred += chunk.length;
      if (transferred > MAX_BRIDGE_UPLOAD) {
        req.unpipe(upstream);
        this.json(res, 413, { error: "Bridge uploads are limited to 100 MB" });
        upstream.destroy();
      }
    });
    req.pipe(upstream);
  }
}
