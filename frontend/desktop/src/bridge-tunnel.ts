import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import dns from "node:dns";
import fs from "node:fs/promises";
import https from "node:https";
import { isIP } from "node:net";
import path from "node:path";
import { promisify } from "node:util";

// Pin the helper and verify official release SHA-256 values before executing it.
const VERSION = "2026.10.0";
const ASSETS: Record<string, [string, string]> = {
  "win32-x64": [
    "cloudflared-windows-amd64.exe",
    "86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c",
  ],
  "win32-arm64": [
    "cloudflared-windows-amd64.exe",
    "86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c",
  ],
  "darwin-x64": [
    "cloudflared-darwin-amd64.tgz",
    "903845b81828c8cb3c5d13d816a2de71c06a3da5785469df8eb0e1b736d92f9f",
  ],
  "darwin-arm64": [
    "cloudflared-darwin-arm64.tgz",
    "a2f79ff7b9420aa537d74af239f376da170bbabeb529aec416002adac6a72e70",
  ],
  "linux-x64": [
    "cloudflared-linux-amd64",
    "d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db",
  ],
  "linux-arm64": [
    "cloudflared-linux-arm64",
    "e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08",
  ],
};

export async function installBridgeTunnel(cacheDir: string, signal: AbortSignal): Promise<string> {
  const asset = ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error("Bridge Mode is not supported on this computer architecture.");
  const [name, expectedHash] = asset;
  const dir = path.join(cacheDir, VERSION, `${process.platform}-${process.arch}`);
  await fs.mkdir(dir, { recursive: true });
  const downloadPath = path.join(dir, name);
  const valid = async () => {
    try {
      return (
        createHash("sha256")
          .update(await fs.readFile(downloadPath))
          .digest("hex") === expectedHash
      );
    } catch {
      return false;
    }
  };
  if (!(await valid())) {
    const response = await fetch(
      `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/${name}`,
      {
        signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
      },
    );
    if (!response.ok || !response.body)
      throw new Error("Unable to download the Bridge helper. Check your internet connection and try again.");
    const temporary = `${downloadPath}.download`;
    const file = await fs.open(temporary, "w", 0o700);
    const digest = createHash("sha256");
    let bytes = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        bytes += chunk.length;
        if (bytes > 128 * 1024 * 1024) throw new Error("Unexpected Bridge helper download size.");
        digest.update(chunk);
        await file.writeFile(chunk);
      }
      if (digest.digest("hex") !== expectedHash)
        throw new Error("Bridge helper integrity verification failed. Please try again.");
      await file.close();
      await fs.rename(temporary, downloadPath);
    } catch (error) {
      await file.close().catch(() => {});
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }
  signal.throwIfAborted();
  let binary = downloadPath;
  if (name.endsWith(".tgz")) {
    // Extract only the verified executable, never the rest of the archive.
    await promisify(execFile)("tar", ["-xzf", downloadPath, "-C", dir, "cloudflared"], {
      signal,
      timeout: 60000,
      windowsHide: true,
    });
    binary = path.join(dir, "cloudflared");
  }
  if (process.platform !== "win32") await fs.chmod(binary, 0o700);
  return binary;
}

export function launchBridgeTunnel(binary: string, port: number, config: string, signal: AbortSignal) {
  const child = spawn(
    binary,
    ["tunnel", "--config", config, "--no-autoupdate", "--url", `http://127.0.0.1:${port}`],
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const ready = new Promise<string>((resolve, reject) => {
    let output = "";
    let settled = false;
    const finish = (error?: Error, url?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) {
        child.kill();
        reject(error);
      } else if (url) resolve(url);
      else {
        child.kill();
        reject(new Error("The tunnel did not provide a URL."));
      }
    };
    const abort = () => finish(new Error("Bridge startup cancelled."));
    const timer = setTimeout(
      () => finish(new Error("The internet tunnel could not connect. Check your connection and try again.")),
      60000,
    );
    signal.addEventListener("abort", abort, { once: true });
    const read = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-16000);
      const url = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
      if (url && /Registered tunnel connection/.test(output)) finish(undefined, url);
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("error", () => finish(new Error("Unable to start the Bridge helper.")));
    child.once("exit", () => finish(new Error("The internet tunnel stopped before connecting. Try again.")));
    if (signal.aborted) abort();
  });
  return { child, ready };
}

export type BridgeTunnelProcess = ChildProcess;

export async function bridgeTunnelReachable(origin: string, signal: AbortSignal): Promise<boolean> {
  let address: string | undefined;
  try {
    const hostname = new URL(origin).hostname;
    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
      {
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      },
    );
    if (response.ok) {
      const data = (await response.json()) as { Answer?: { type: number; data: string }[] };
      address = data.Answer?.find((answer) => answer.type === 1 && isIP(answer.data) === 4)?.data;
    }
  } catch {
    /* Fall back to the configured resolver when DoH is unavailable. */
  }
  return new Promise((resolve) => {
    const request = https.get(
      new URL("/bridge/session", origin),
      {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        family: 4,
        // Windows caches initial NXDOMAIN responses in getaddrinfo for minutes.
        // Query the configured resolver directly while the new record propagates.
        lookup: (hostname, _options, callback) => {
          if (address) {
            callback(null, address, 4);
            return;
          }
          dns.resolve4(hostname, (error, addresses) => callback(error, addresses?.[0] || "", 4));
        },
      },
      (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => {
          body += chunk.toString();
          if (body.length > 4096) {
            response.destroy();
            resolve(false);
          }
        });
        response.on("error", () => resolve(false));
        response.on("end", () => {
          try {
            resolve(response.statusCode === 401 && JSON.parse(body).status === "expired");
          } catch {
            resolve(false);
          }
        });
      },
    );
    request.on("error", () => resolve(false));
  });
}
