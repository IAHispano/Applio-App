const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { test } = require("node:test");
const { BridgeSessions, INVITE_TTL, REQUEST_TTL, SESSION_TTL } = require("../dist/bridge-sessions");
const { BridgeGateway, MAX_BRIDGE_UPLOAD, bridgeApiAllowed } = require("../dist/bridge-gateway");

test("invitations, pending requests and approved sessions expire independently", () => {
  let now = 1000;
  const revoked = [];
  const sessions = new BridgeSessions(
    () => now,
    (id) => revoked.push(id),
  );
  const first = sessions.newInvite();
  assert.throws(() => sessions.request("wrong", "Phone"), /expired/);
  const pending = sessions.request(first.token, "Phone");
  assert.equal(sessions.find(pending.credential).status, "pending");
  assert.equal("credential" in pending.device, false);
  assert.equal("credential" in sessions.list()[0], false);
  now += REQUEST_TTL;
  assert.equal(sessions.find(pending.credential), undefined);
  assert.deepEqual(revoked, [pending.device.id]);
  assert.throws(() => sessions.approve(pending.device.id), /expired/);
  const approved = sessions.request(first.token, "Borrowed computer");
  sessions.approve(approved.device.id);
  now += INVITE_TTL;
  assert.throws(() => sessions.request(first.token, "Phone"), /expired/);
  assert.equal(sessions.find(approved.credential).status, "approved");
  now += SESSION_TTL;
  assert.equal(sessions.find(approved.credential), undefined);
});

test("rotating an invitation invalidates its predecessor; stopping clears every credential", () => {
  const sessions = new BridgeSessions();
  const old = sessions.newInvite();
  const current = sessions.newInvite();
  assert.throws(() => sessions.request(old.token, "Phone"), /expired/);
  const request = sessions.request(current.token, "Phone");
  sessions.approve(request.device.id);
  sessions.clear();
  assert.deepEqual(sessions.list(), []);
  assert.equal(sessions.find(request.credential), undefined);
  assert.throws(() => sessions.request(current.token, "Phone"), /expired/);
});

test("remote capabilities exclude host administration and SSE", () => {
  for (const [method, path] of [
    ["POST", "/api/setup/install"],
    ["POST", "/api/settings/restart"],
    ["PUT", "/api/settings"],
    ["POST", "/api/plugins/install"],
    ["POST", "/api/train/preprocess"],
    ["POST", "/api/realtime/start"],
    ["DELETE", "/api/models/model"],
    ["GET", "/api/jobs/events"],
    ["GET", "/api/jobs/example/events"],
    ["GET", "/api/report/info"],
  ])
    assert.equal(bridgeApiAllowed(method, path), false, `${method} ${path}`);
  for (const [method, path] of [
    ["POST", "/api/inference"],
    ["POST", "/api/inference/batch"],
    ["POST", "/api/tts"],
    ["POST", "/api/uvr/separate"],
    ["GET", "/api/models/library"],
    ["GET", "/api/train/gpus"],
    ["GET", "/api/setup/status"],
    ["GET", "/api/jobs/example"],
    ["PUT", "/api/settings/model-presets"],
  ])
    assert.equal(bridgeApiAllowed(method, path), true, `${method} ${path}`);
});

async function fixture(t) {
  const seen = [];
  const api = http.createServer(async (req, res) => {
    const record = { url: req.url, method: req.method, headers: req.headers, body: "" };
    seen.push(record);
    if (req.url === "/api/jobs/stream") {
      res.writeHead(200);
      res.write("streaming");
      return;
    }
    for await (const chunk of req) record.body += chunk.toString();
    res.setHeader("Set-Cookie", "upstream=leak");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(JSON.stringify({ ok: true, body: record.body }));
  });
  const web = http.createServer((_req, res) => res.end("Applio UI"));
  api.listen(0, "127.0.0.1");
  web.listen(0, "127.0.0.1");
  await Promise.all([once(api, "listening"), once(web, "listening")]);
  const requested = [];
  const gateway = new BridgeGateway(web.address().port, api.address().port, (device) =>
    requested.push(device),
  );
  const port = await gateway.listen();
  const origin = "https://bridge.example";
  gateway.setOrigin(origin);
  t.after(() => {
    gateway.stop();
    api.closeAllConnections();
    web.closeAllConnections();
    api.close();
    web.close();
  });
  const request = (path, { method = "GET", headers = {}, body = "" } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: "127.0.0.1", port, path, method, headers: { Host: "bridge.example", ...headers } },
        (res) => {
          let result = "";
          res.on("data", (chunk) => (result += chunk.toString()));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: result }));
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  const pair = async (name = "Phone") => {
    const invite = gateway.sessions.newInvite();
    const response = await request("/bridge/pair", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ invite: invite.token, name }),
    });
    assert.equal(response.status, 202);
    const cookie = response.headers["set-cookie"][0].split(";")[0];
    const device = requested.at(-1);
    return { cookie, device, response };
  };
  return { api, web, gateway, port, origin, request, pair, seen };
}

test("unauthenticated and pending browsers cannot read UI, outputs, assets or API", async (t) => {
  const f = await fixture(t);
  for (const path of ["/api/models", "/outputs/private.wav", "/assets/config.json", "/_next/static/app.js"]) {
    assert.equal((await f.request(path)).status, 401);
  }
  assert.equal((await f.request("/inference", { headers: { Accept: "text/html" } })).status, 303);
  assert.equal((await f.request("/bridge", { headers: { Host: "attacker.example" } })).status, 421);
  const page = await f.request("/bridge");
  assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(page.body, /history.replaceState/);
  const { cookie, device, response } = await f.pair();
  assert.match(response.headers["set-cookie"][0], /Secure; HttpOnly; SameSite=Strict/);
  assert.equal(
    JSON.parse((await f.request("/bridge/session", { headers: { Cookie: cookie } })).body).code,
    device.code,
  );
  assert.equal((await f.request("/api/models", { headers: { Cookie: cookie } })).status, 401);
  assert.equal(f.seen.length, 0);
});

test("approval unlocks the UI and streamed uploads, with credentials kept out of upstream", async (t) => {
  const f = await fixture(t);
  const { cookie, device } = await f.pair();
  f.gateway.sessions.approve(device.id);
  const ui = await f.request("/inference", { headers: { Cookie: cookie } });
  assert.equal((await f.request("/API/plugins", { headers: { Cookie: cookie } })).status, 403);
  assert.equal(ui.body, "Applio UI");
  const audio = "audio-bytes".repeat(20000);
  const result = await f.request("/api/inference", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: f.origin,
      Authorization: "Bearer private",
      "X-Forwarded-Host": "evil",
      "Content-Type": "audio/wav",
    },
    body: audio,
  });
  assert.equal(result.status, 200);
  assert.equal(f.seen[0].body, audio);
  assert.equal(f.seen[0].headers.cookie, undefined);
  assert.equal(f.seen[0].headers.authorization, undefined);
  assert.equal(f.seen[0].headers["x-forwarded-host"], undefined);
  assert.equal(result.headers["set-cookie"], undefined);
  assert.equal(result.headers["access-control-allow-origin"], undefined);
  assert.equal(result.headers["cache-control"], "no-store");
});

test("cross-origin writes, encoded route bypasses and oversized uploads are rejected", async (t) => {
  const f = await fixture(t);
  const { cookie, device } = await f.pair();
  f.gateway.sessions.approve(device.id);
  for (const origin of [undefined, "https://attacker.example"]) {
    assert.equal(
      (
        await f.request("/api/inference", {
          method: "POST",
          headers: { Cookie: cookie, ...(origin ? { Origin: origin } : {}) },
        })
      ).status,
      403,
    );
  }
  for (const path of [
    "/%61pi/setup/install",
    "/api%2fsetup/install",
    "/api/../api/plugins",
    "/api//settings",
    "/outputs/%2e%2e/private.txt",
  ]) {
    assert.equal((await f.request(path, { headers: { Cookie: cookie } })).status, 400, path);
  }
  assert.equal(
    (
      await f.request("/api/settings/restart", {
        method: "POST",
        headers: { Cookie: cookie, Origin: f.origin },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.request("/inference", { method: "POST", headers: { Cookie: cookie, Origin: f.origin } })).status,
    403,
  );
  assert.equal(
    (
      await f.request("/api/inference", {
        method: "POST",
        headers: { Cookie: cookie, Origin: f.origin, "Content-Length": MAX_BRIDGE_UPLOAD + 1 },
      })
    ).status,
    413,
  );
  assert.equal(f.seen.length, 0);
});

test("revoking one device closes its streams and leaves another device usable", async (t) => {
  const f = await fixture(t);
  const first = await f.pair("Phone");
  const second = await f.pair("Laptop");
  f.gateway.sessions.approve(first.device.id);
  f.gateway.sessions.approve(second.device.id);
  let req;
  const disconnected = new Promise((resolve, reject) => {
    req = http.get(
      {
        hostname: "127.0.0.1",
        port: f.port,
        path: "/api/jobs/stream",
        headers: { Host: "bridge.example", Cookie: first.cookie },
      },
      (res) => {
        res.once("data", () => f.gateway.sessions.revoke(first.device.id));
        res.on("close", resolve);
        res.on("error", () => {});
      },
    );
    req.on("error", reject);
  });
  await disconnected;
  assert.equal((await f.request("/api/models", { headers: { Cookie: first.cookie } })).status, 401);
  assert.equal((await f.request("/api/models", { headers: { Cookie: second.cookie } })).status, 200);
  const logout = await f.request("/bridge/logout", {
    method: "POST",
    headers: { Cookie: second.cookie, Origin: f.origin },
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers["set-cookie"][0], /Max-Age=0/);
  assert.equal((await f.request("/api/models", { headers: { Cookie: second.cookie } })).status, 401);
  req.destroy();
});

test("stopping the gateway revokes all devices and closes the listener", async (t) => {
  const f = await fixture(t);
  const first = await f.pair();
  f.gateway.sessions.approve(first.device.id);
  f.gateway.stop();
  assert.equal(f.gateway.sessions.find(first.cookie.split("=")[1]), undefined);
  await assert.rejects(f.request("/api/models"));
});

test("live internet tunnel carries only approved synthetic requests", {
  skip: process.env.APPLIO_BRIDGE_TUNNEL_SMOKE !== "1",
  timeout: 240000,
}, async (t) => {
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const { BridgeMode } = require("../dist/bridge-mode");
  const f = await fixture(t);
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "applio-bridge-smoke-"));
  const bridge = new BridgeMode({ cacheDir, webPort: f.web.address().port, apiPort: f.api.address().port });
  t.after(async () => {
    bridge.stop();
    assert.equal(path.dirname(cacheDir), os.tmpdir());
    await fs.rm(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const state = await bridge.start();
  assert.equal(state.status, "sharing", state.message);
  const url = new URL(state.link);
  const invite = new URLSearchParams(url.hash.slice(1)).get("invite");
  // Use the same public resolver as startup. The host's router may retain
  // negative answers for newly created names even when the public record exists.
  const dnsResponse = await fetch(`https://cloudflare-dns.com/dns-query?name=${url.hostname}&type=A`, {
    headers: { Accept: "application/dns-json" },
    signal: AbortSignal.timeout(10000),
  });
  const address = (await dnsResponse.json()).Answer?.find((answer) => answer.type === 1)?.data;
  assert.ok(address, "The public tunnel hostname must have an A record");
  const remote = (pathname, options = {}) =>
    new Promise((resolve, reject) => {
      const req = require("node:https").request(
        `${url.origin}${pathname}`,
        {
          method: options.method || "GET",
          headers: options.headers,
          family: 4,
          lookup: (_host, _options, callback) => callback(null, address, 4),
          signal: AbortSignal.timeout(30000),
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("error", reject);
          res.on("end", () => {
            const headers = new Headers();
            for (const [name, value] of Object.entries(res.headers)) {
              for (const item of Array.isArray(value) ? value : value ? [value] : [])
                headers.append(name, item);
            }
            resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers }));
          });
        },
      );
      req.on("error", reject);
      req.end(options.body);
    });
  // Wait for the newly registered public hostname to propagate.
  let unauthenticated;
  let lastFailure;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      unauthenticated = await remote("/api/models");
      if (unauthenticated.status === 401) break;
    } catch (error) {
      lastFailure = error.cause?.code || error.message;
      /* hostname may still be propagating */
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.equal(
    unauthenticated?.status,
    401,
    `Public tunnel check: ${lastFailure || unauthenticated?.status}`,
  );
  const pairing = await remote("/bridge/pair", {
    method: "POST",
    headers: { Origin: url.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ invite, name: "Synthetic test browser" }),
  });
  assert.equal(pairing.status, 202);
  const cookie = pairing.headers.get("set-cookie").split(";")[0];
  assert.equal((await remote("/api/models", { headers: { Cookie: cookie } })).status, 401);
  bridge.approve(bridge.getState().devices[0].id);
  const response = await remote("/api/inference", {
    method: "POST",
    headers: { Cookie: cookie, Origin: url.origin },
    body: "synthetic-audio",
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).body, "synthetic-audio");
  bridge.revoke(bridge.getState().devices[0].id);
  assert.equal((await remote("/api/models", { headers: { Cookie: cookie } })).status, 401);
  bridge.stop();
  assert.deepEqual(bridge.getState(), { status: "stopped", devices: [] });
});
