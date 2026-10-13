const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

const webRoot = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(webRoot, "../../assets/config_template.json"), "utf8"));
const models = ["logs/alto/alto.pth", "logs/bass/bass.pth", "logs/tenor/tenor.pth"];
let browser, server, base;
let logs = "";
const auditOnly = process.env.APPLIO_A11Y_AUDIT_ONLY === "1";

function response(url) {
  const endpoint = new URL(url).pathname;
  const data = {
    "/api/setup/status": { ready: true, checks: [], checkedAt: new Date().toISOString() },
    "/api/settings": { config, logsDir: "logs", defaultLogsDir: "logs" },
    "/api/settings/language": { code: "en_US", dict: {} },
    "/api/settings/languages": {
      languages: ["en_US", "fr_FR"],
      named: [
        { code: "en_US", name: "English" },
        { code: "fr_FR", name: "French" },
      ],
    },
    "/api/settings/themes": { themes: [] },
    "/api/settings/theme": { id: "", theme: {} },
    "/api/settings/presence": { running: false },
    "/api/settings/model-presets": { presets: {} },
    "/api/settings/version": { version: "0.2.8" },
    "/api/settings/version-check": {
      local: "0.2.8",
      latest: "0.2.8",
      isOutdated: false,
      status: "up-to-date",
      versionsBehind: 0,
    },
    "/api/settings/storage": {
      stats: {
        uploadsBytes: 0,
        uploadsCount: 0,
        outputsBytes: 0,
        outputsCount: 0,
        totalBytes: 0,
        totalFiles: 0,
      },
    },
    "/api/models": { models, indexes: ["logs/alto/alto.index"], audios: [] },
    "/api/models/library": {
      models: models.map((pthPath) => ({
        pthPath,
        name: path.basename(pthPath, ".pth"),
        indexPath: null,
        modifiedAt: "2026-01-01T00:00:00Z",
        size: 1000,
      })),
    },
    "/api/models/inspect": { ok: true, metadata: { sampleRate: 40000, version: "v2", f0: 1 } },
    "/api/models/speakers": { speakers: [0] },
    "/api/train/datasets": { datasets: ["assets/datasets/test"] },
    "/api/train/gpus": { count: 1, info: "Test GPU", devices: [{ id: "0", name: "Test GPU" }] },
    "/api/train/pretraineds": { g: [], d: [] },
    "/api/report/info": {
      cpus: 8,
      totalMemGB: 16,
      version: "0.2.8",
      platform: "test",
      node: "22",
      python: "3.12",
    },
    "/api/jobs/activity": { jobs: [] },
    "/api/tts/voices": { voices: [{ ShortName: "en-US-Test", FriendlyName: "Test voice", Locale: "en-US" }] },
    "/api/realtime/config": { realtime: { model_file: "", auto_chunk: false } },
    "/api/realtime/status": { running: false, logs: [] },
  };
  return data[endpoint] || { ok: true, jobs: [] };
}

before(async () => {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-p", String(port)], {
    cwd: webRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (value) => {
      logs = (logs + value).slice(-6000);
    });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(logs);
    try {
      ready = (await fetch(base)).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
});
after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) {
    const closed = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await closed;
  }
});

async function openPage(route, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
    ...options,
  });
  await context.route("**/api/**", (request) =>
    request.fulfill({
      contentType: "application/json",
      body: JSON.stringify(response(request.request().url())),
    }),
  );
  await context.route("**/bridge/session", (request) =>
    request.fulfill({ status: 404, contentType: "application/json", body: '{"status":"local"}' }),
  );
  await context.addInitScript(() => localStorage.setItem("applio:terms-accepted", "true"));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + route);
  await page.locator("main h1").waitFor();
  await page.waitForTimeout(500);
  return { page, context, errors };
}

async function audit(page, name) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations = result.violations.map(({ id, impact, nodes }) => ({
    id,
    impact,
    nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
  }));
  if (auditOnly) console.log(name, JSON.stringify(violations, null, 2));
  else assert.deepEqual(violations, [], `${name}: ${JSON.stringify(violations, null, 2)}`);
}

test("primary screens have accessible names, roles and contrast", { timeout: 90000 }, async () => {
  for (const route of ["/", "/inference", "/train", "/settings", "/tts"]) {
    const { page, context, errors } = await openPage(route);
    try {
      await audit(page, route);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
});

test("open model and setting menus expose valid selection widgets", { timeout: 30000 }, async () => {
  const { page, context } = await openPage("/inference");
  try {
    await page.locator('[id^="voice-model-"]').first().click();
    await page.getByPlaceholder("Search models…").waitFor();
    await audit(page, "model menu");
    await page.keyboard.press("Escape");
    await page.locator("#infer-f0-method-select").click();
    await page.getByPlaceholder("Search options…").waitFor();
    await audit(page, "pitch menu");
  } finally {
    await context.close();
  }
});

test("keyboard selection restores focus and keeps its indicator visible", async () => {
  const { page, context } = await openPage("/inference");
  try {
    const trigger = page.locator('[id^="voice-model-"]').first();
    await trigger.focus();
    await page.keyboard.press("Enter");
    const search = page.getByPlaceholder("Search models…");
    await search.waitFor();
    await search.fill("tenor");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await trigger.filter({ hasText: "tenor" }).waitFor();
    assert.ok(await trigger.evaluate((element) => element === document.activeElement));
    const outline = await trigger.evaluate((element) => getComputedStyle(element).outlineStyle);
    assert.notEqual(outline, "none");
    await page.emulateMedia({ forcedColors: "active" });
    assert.notEqual(await trigger.evaluate((element) => getComputedStyle(element).outlineStyle), "none");
  } finally {
    await context.close();
  }
});

test("mobile navigation isolates focus and announces route changes", async () => {
  const { page, context } = await openPage("/", { viewport: { width: 390, height: 844 } });
  try {
    const more = page.getByRole("button", { name: "More", exact: true });
    await more.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Menu", exact: true });
    await dialog.waitFor();
    await audit(page, "mobile navigation");
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      assert.ok(await dialog.evaluate((element) => element.contains(document.activeElement)));
    }
    await page.keyboard.press("Escape");
    assert.ok(await more.evaluate((element) => element === document.activeElement));
    await more.click();
    await dialog.getByRole("link", { name: "Settings", exact: true }).click();
    await page.waitForURL("**/settings");
    await page.waitForFunction(() => document.activeElement?.matches("main h1"));
    assert.equal(await page.locator("dialog[open]").count(), 0);
  } finally {
    await context.close();
  }
});

test("dropdowns inside training dialogs stay interactive and Escape closes one layer", async () => {
  const { page, context } = await openPage("/train");
  try {
    await page.getByRole("tab", { name: "Manual", exact: true }).click();
    const launch = page.getByRole("button", { name: "Run Preprocess", exact: true });
    await launch.click();
    const dialog = page.getByRole("dialog", { name: "Step 1 — Preprocess Dataset", exact: true });
    await dialog.waitFor();
    await audit(page, "training dialog");
    const trigger = dialog.locator("#modal-prep-sample-rate");
    await trigger.click();
    const search = dialog.getByPlaceholder("Search options…");
    await search.waitFor();
    await search.fill("48000");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.ok(await trigger.evaluate((element) => element === document.activeElement));
    await trigger.click();
    await search.waitFor();
    await audit(page, "dropdown inside dialog");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog[open]").count(), 1);
    assert.equal(await search.count(), 0);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.ok(await launch.evaluate((element) => element === document.activeElement));
  } finally {
    await context.close();
  }
});
