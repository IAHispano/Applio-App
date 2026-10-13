import fs from "node:fs/promises";
import path from "node:path";
import { BridgeGateway } from "./bridge-gateway";
import type { BridgePairingLanguage } from "./bridge-page";
import type { BridgeDevice } from "./bridge-sessions";
import {
  type BridgeTunnelProcess,
  bridgeTunnelReachable,
  installBridgeTunnel,
  launchBridgeTunnel,
} from "./bridge-tunnel";

export interface BridgeState {
  status: "stopped" | "starting" | "sharing" | "error";
  message?: string;
  link?: string;
  inviteExpiresAt?: number;
  devices: BridgeDevice[];
}

export class BridgeMode {
  private state: BridgeState = { status: "stopped", devices: [] };
  private gateway?: BridgeGateway;
  private tunnel?: BridgeTunnelProcess;
  private controller?: AbortController;
  private origin?: string;
  private startup?: Promise<BridgeState>;

  constructor(
    private readonly options: {
      cacheDir: string;
      webPort: number;
      apiPort: number;
      fontPath?: string;
      pairingLanguage?: () => BridgePairingLanguage;
      onRequest?: (device: BridgeDevice) => void;
    },
  ) {}

  getState(): BridgeState {
    return { ...this.state, devices: this.gateway?.sessions.list() || [] };
  }

  start(): Promise<BridgeState> {
    if (this.startup) return this.startup;
    if (this.state.status === "sharing") return Promise.resolve(this.getState());
    const controller = new AbortController();
    this.controller = controller;
    this.state = { status: "starting", message: "Preparing the internet tunnel…", devices: [] };
    const startup = this.open(controller);
    this.startup = startup;
    void startup.finally(() => {
      if (this.startup === startup) this.startup = undefined;
    });
    return startup;
  }

  stop(): BridgeState {
    this.controller?.abort();
    this.controller = undefined;
    this.tunnel?.kill();
    this.tunnel = undefined;
    this.gateway?.stop();
    this.gateway = undefined;
    this.origin = undefined;
    this.state = { status: "stopped", devices: [] };
    return this.getState();
  }

  newInvite(): BridgeState {
    if (!this.gateway || !this.origin || this.state.status !== "sharing")
      throw new Error("Start Bridge Mode first.");
    const invite = this.gateway.sessions.newInvite();
    this.state = {
      status: "sharing",
      link: `${this.origin}/bridge#invite=${invite.token}`,
      inviteExpiresAt: invite.expiresAt,
      devices: [],
    };
    return this.getState();
  }

  approve(id: string): BridgeState {
    if (!this.gateway || this.state.status !== "sharing") throw new Error("Bridge Mode is stopped.");
    this.gateway.sessions.approve(id);
    return this.getState();
  }

  revoke(id: string): BridgeState {
    this.gateway?.sessions.revoke(id);
    return this.getState();
  }

  private async open(controller: AbortController): Promise<BridgeState> {
    try {
      const binary = await installBridgeTunnel(this.options.cacheDir, controller.signal);
      controller.signal.throwIfAborted();
      const config = path.join(this.options.cacheDir, "bridge-config.yml");
      // Ignore the user's existing cloudflared configuration when creating a temporary tunnel.
      await fs.writeFile(config, "{}\n", { mode: 0o600 });
      controller.signal.throwIfAborted();
      const font = this.options.fontPath ? await fs.readFile(this.options.fontPath) : undefined;
      controller.signal.throwIfAborted();
      const gateway = new BridgeGateway(
        this.options.webPort,
        this.options.apiPort,
        this.options.onRequest,
        font,
        this.options.pairingLanguage,
      );
      this.gateway = gateway;
      const port = await gateway.listen();
      if (controller.signal.aborted) {
        gateway.stop();
        controller.signal.throwIfAborted();
      }
      const { child, ready } = launchBridgeTunnel(binary, port, config, controller.signal);
      this.tunnel = child;
      child.once("exit", () => {
        if (this.tunnel !== child) return;
        this.stop();
        this.state = {
          status: "error",
          message: "The internet tunnel disconnected. Start sharing again to create a new link.",
          devices: [],
        };
      });
      const origin = await ready;
      controller.signal.throwIfAborted();
      gateway.setOrigin(origin);
      // A registered connector can precede DNS/edge readiness. Never offer an
      // invitation until the public hostname actually reaches our auth gateway.
      this.state.message = "Waiting for the private link to become reachable…";
      const deadline = Date.now() + 60000;
      let reachable = false;
      while (Date.now() < deadline && !reachable) {
        controller.signal.throwIfAborted();
        try {
          reachable = await bridgeTunnelReachable(origin, controller.signal);
        } catch {
          /* The tunnel hostname/route can take a few seconds to propagate. */
        }
        if (!reachable)
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              controller.signal.removeEventListener("abort", done);
              resolve();
            };
            const timer = setTimeout(done, 2000);
            controller.signal.addEventListener("abort", done, { once: true });
            if (controller.signal.aborted) done();
          });
      }
      controller.signal.throwIfAborted();
      if (!reachable)
        throw new Error(
          "The internet tunnel connected, but its public link is unreachable. Try again or check your network/DNS settings.",
        );
      this.origin = origin;
      this.state = { status: "sharing", devices: [] };
      return this.newInvite();
    } catch (error) {
      if (this.controller === controller) {
        this.stop();
        this.state = { status: "error", message: (error as Error).message, devices: [] };
      }
      return this.getState();
    }
  }
}
