import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "backend/api/package.json"));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "applio-voice-focus-"));
const state = {
  supported: true,
  failNode: false,
  failDisconnect: false,
  failStop: false,
  stops: 0,
  destroys: 0,
  connections: [],
};
globalThis.__voiceFocusTest = state;
try {
  const bundle = path.join(temporary, "voice-focus.cjs");
  await require("esbuild").build({
    entryPoints: [path.join(root, "frontend/web/lib/voice-focus.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundle,
    plugins: [
      {
        name: "sdk-fixture",
        setup(build) {
          build.onResolve(
            { filter: /^amazon-chime-sdk-js\/build\/voicefocus\/VoiceFocusDeviceTransformer$/ },
            () => ({ path: "sdk", namespace: "fixture" }),
          );
          build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: `
        const state = globalThis.__voiceFocusTest;
        export default class Transformer {
          static async create(spec) { state.variant = spec.variant; return new Transformer(); }
          isSupported() { return state.supported; }
          static async destroyVoiceFocus() { state.destroys++; }
          async createTransformDevice() { return {
            async stop() { state.stops++; if (state.failStop) throw new Error('fixture stop error'); },
            async createAudioNode() {
              if (state.failNode) throw new Error('fixture initialization error');
              return { start: {}, end: { connect(node) { state.connections.push(node); }, disconnect() { if (state.failDisconnect) throw new Error('fixture disconnect error'); } } };
            }
          }; }
        }
      `,
            loader: "js",
          }));
        },
      },
    ],
  });
  const { connectVoiceFocus } = require(bundle);
  const source = {
    connect(node) {
      state.connections.push(node);
    },
  };
  const output = {};
  const stop = await connectVoiceFocus({}, source, output, {}, "c20");
  assert.equal(state.variant, "c20");
  assert.equal(state.connections.length, 2);
  await Promise.all([stop(), stop()]);
  assert.equal(state.stops, 1);
  assert.equal(state.destroys, 1);
  state.supported = false;
  await assert.rejects(connectVoiceFocus({}, source, output, {}, "c50"), /unavailable/);
  assert.equal(state.destroys, 2);
  state.supported = true;
  state.failNode = true;
  await assert.rejects(connectVoiceFocus({}, source, output, {}, "c100"), /initialization error/);
  assert.equal(state.stops, 2);
  assert.equal(state.destroys, 3);
  state.failNode = false;
  for (const variant of ["c50", "c100"]) {
    const cleanup = await connectVoiceFocus({}, source, output, {}, variant);
    assert.equal(state.variant, variant);
    await cleanup();
  }
  for (const failure of ["failDisconnect", "failStop"]) {
    const cleanup = await connectVoiceFocus({}, source, output, {}, "c20");
    const stops = state.stops;
    const destroys = state.destroys;
    state[failure] = true;
    await assert.rejects(cleanup(), /fixture .* error/);
    assert.equal(state.stops, stops + 1);
    assert.equal(state.destroys, destroys + 1);
    await cleanup();
    state[failure] = false;
  }
  console.log(
    "Voice Focus variants, node wiring, unsupported browsers, initialization failure and repeated cleanup passed.",
  );
} finally {
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  fs.rmSync(temporary, { recursive: true, force: true });
  delete globalThis.__voiceFocusTest;
}
