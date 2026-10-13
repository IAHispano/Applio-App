import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const INVITE_TTL = 10 * 60 * 1000;
export const REQUEST_TTL = 5 * 60 * 1000;
export const SESSION_TTL = 8 * 60 * 60 * 1000;

export interface BridgeDevice {
  id: string;
  name: string;
  code: string;
  status: "pending" | "approved";
  expiresAt: number;
}

const secret = () => randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest();

/** Only hashes of browser credentials are retained; nothing survives stop/restart. */
export class BridgeSessions {
  private invite?: { hash: Buffer; expiresAt: number };
  private devices = new Map<string, BridgeDevice & { credential: Buffer }>();

  constructor(
    private readonly now = Date.now,
    private readonly onRevoke = (_id: string) => {},
  ) {}

  newInvite() {
    const token = secret();
    this.invite = { hash: hash(token), expiresAt: this.now() + INVITE_TTL };
    return { token, expiresAt: this.invite.expiresAt };
  }

  request(token: string, name: string) {
    this.prune();
    if (!this.invite || !timingSafeEqual(hash(token), this.invite.hash)) {
      throw new Error("This invitation has expired. Create a new link on the host computer.");
    }
    if (this.devices.size >= 16) throw new Error("Too many devices. Remove a device on the host first.");
    const credential = secret();
    const device = {
      id: randomBytes(16).toString("hex"),
      code: randomBytes(4).toString("hex").toUpperCase(),
      name: name.replace(/\p{C}/gu, "").trim().slice(0, 64) || "Browser",
      status: "pending" as const,
      expiresAt: this.now() + REQUEST_TTL,
      credential: hash(credential),
    };
    this.devices.set(device.id, device);
    return { credential, device: this.publicDevice(device) };
  }

  find(credential: string | undefined): BridgeDevice | undefined {
    this.prune();
    if (!credential || credential.length > 128) return undefined;
    const digest = hash(credential);
    for (const device of this.devices.values()) {
      if (timingSafeEqual(device.credential, digest)) return this.publicDevice(device);
    }
    return undefined;
  }

  approve(id: string) {
    this.prune();
    const device = this.devices.get(id);
    if (device?.status !== "pending") throw new Error("This connection request has expired.");
    device.status = "approved";
    device.expiresAt = this.now() + SESSION_TTL;
  }

  revoke(id: string) {
    if (this.devices.delete(id)) this.onRevoke(id);
  }

  clear() {
    for (const id of this.devices.keys()) this.revoke(id);
    this.invite = undefined;
  }

  list(): BridgeDevice[] {
    this.prune();
    return [...this.devices.values()].map((device) => this.publicDevice(device));
  }

  private prune() {
    if (this.invite && this.invite.expiresAt <= this.now()) this.invite = undefined;
    for (const device of this.devices.values()) {
      if (device.expiresAt <= this.now()) this.revoke(device.id);
    }
  }

  private publicDevice({ credential: _credential, ...device }: BridgeDevice & { credential: Buffer }) {
    return device;
  }
}
