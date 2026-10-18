import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { releaseNotes } from "./release-notes.mjs";

function load(relative, imports = {}, globals = {}) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const exports = {};
  new Function("exports", "require", ...Object.keys(globals), outputText)(
    exports,
    (name) => imports[name] || {},
    ...Object.values(globals),
  );
  return exports;
}

const policy = load("../frontend/web/lib/update-policy.ts");
const repository = "https://github.com/IAHispano/Applio-App";

test("deferral persists for exactly the skipped release and a later release prompts again", () => {
  const values = new Map();
  const localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  let app = load("../frontend/web/lib/update-policy.ts", {}, { localStorage });
  app.deferUpdate("v1.0.3");
  app = load("../frontend/web/lib/update-policy.ts", {}, { localStorage });
  assert.equal(app.updateIsDeferred("1.0.3"), true);
  assert.equal(app.updateIsDeferred("v1.0.4"), false);
  assert.equal(app.shouldPromptForUpdate("v1.0.3", "V1.0.3"), false);
});

test("release notes expose commit and comparison links without rendering arbitrary HTML or URLs", () => {
  const links = policy.releaseLinks(repository, "v1.0.2", "1.0.3");
  assert.equal(links.compare, `${repository}/compare/v1.0.2...v1.0.3`);
  assert.equal(policy.releaseLinks(repository, "unknown", "1.0.3").compare, null);
  const parts = policy.releaseNoteParts(
    `- [abc123](${repository}/commit/abc123) Fix audio <script>alert(1)</script>`,
    repository,
  );
  assert.equal(parts.find((part) => part.href)?.href, `${repository}/commit/abc123`);
  assert.ok(
    parts.some((part) => part.text.includes("<script>")),
    "HTML must remain text",
  );
  assert.equal(
    policy.releaseNoteParts("[fake](https://evil.test/commit/abc)", repository).some((part) => part.href),
    false,
  );
  assert.equal(
    policy.releaseNoteParts("[fake](javascript:alert(1))", repository).some((part) => part.href),
    false,
  );
});

test("automatic checks never download or install, including when many versions behind or already downloaded", async () => {
  let downloads = 0;
  let installs = 0;
  const events = new Map();
  const timers = [];
  const states = [];
  const refs = [];
  let stateCursor = 0;
  let refCursor = 0;
  let effectsMounted = false;
  let deferred = true;
  let statusCallback;
  const updater = {
    check: async () => ({ status: "available", version: "1.0.3" }),
    getStatus: async () => ({ status: "available", version: "1.0.3" }),
    download: async () => {
      downloads++;
      return { status: "downloaded", version: "1.0.3" };
    },
    quitAndInstall: async () => {
      installs++;
    },
    onStatusChange: (callback) => {
      statusCallback = callback;
      return () => {};
    },
  };
  const jsx = (type, props) => ({ type, props });
  const component = load(
    "../frontend/web/components/setup/AutoUpdateModal.tsx",
    {
      "react/jsx-runtime": { jsx, jsxs: jsx },
      react: {
        useState: (initial) => {
          const slot = stateCursor++;
          if (!(slot in states)) states[slot] = initial;
          return [
            states[slot],
            (value) => {
              states[slot] = value;
            },
          ];
        },
        useRef: (initial) => {
          const slot = refCursor++;
          refs[slot] ??= { current: initial };
          return refs[slot];
        },
        useCallback: (callback) => callback,
        useEffect: (callback) => {
          if (!effectsMounted) callback();
        },
      },
      "@/components/ui": { Button: "Button", Dialog: "Dialog", IconButton: "IconButton" },
      "@/lib/i18n": { useI18n: () => ({ t: (text) => text }) },
      "@/lib/api": {
        apiGet: async () => ({
          local: "1.0.0",
          latest: "1.0.3",
          status: "behind",
          versionsBehind: 3,
          isOutdated: true,
        }),
        displayVersion: (value) => value,
        errMsg: (error) => error.message,
      },
      "@/lib/update-policy": { ...policy, desktopUpdater: () => updater, updateIsDeferred: () => deferred },
    },
    {
      process: { env: { NODE_ENV: "production" } },
      window: {
        addEventListener: (name, callback) => events.set(name, callback),
        removeEventListener: () => {},
      },
      setTimeout: (callback) => {
        timers.push(callback);
        return 1;
      },
      clearTimeout: () => {},
      setInterval: () => 2,
      clearInterval: () => {},
    },
  ).default;
  const render = () => {
    stateCursor = 0;
    refCursor = 0;
    const tree = component();
    effectsMounted = true;
    return tree;
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  assert.equal(render(), null);
  timers[0]();
  await flush();
  assert.equal(render(), null, "Skipped release must stay hidden after startup");
  assert.equal(downloads, 0);
  assert.equal(installs, 0);
  events.get("applio:show-update")();
  await flush();
  const tree = render();
  assert.equal(tree.type, "Dialog", "Settings must reopen a deferred update");
  assert.equal(downloads, 0);
  function button(node, label) {
    if (!node || typeof node !== "object") return null;
    if (node.type === "Button" && node.props.children === label) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = button(child, label);
      if (found) return found;
    }
    return null;
  }
  button(tree, "Update").props.onClick();
  await flush();
  assert.equal(downloads, 1, "An explicit Update click starts the download");
  assert.equal(installs, 0, "Completing a download must not restart the app");
  statusCallback({ status: "downloaded", version: "1.0.3" });
  await flush();
  assert.equal(installs, 0);
  button(render(), "Restart and Update").props.onClick();
  await flush();
  assert.equal(installs, 1);
  deferred = false;
});

test("release generation includes every commit and ships the same notes in the signed updater feed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "applio-update-notes-"));
  try {
    const git = (...args) =>
      execFileSync("git", args, { cwd: directory, encoding: "utf8", windowsHide: true });
    git("init", "-q");
    git("config", "user.name", "Release test");
    git("config", "user.email", "release-test@example.invalid");
    git("commit", "--allow-empty", "-qm", "Initial release");
    git("tag", "v1.0.2");
    git("commit", "--allow-empty", "-qm", "Fix microphone input");
    git("commit", "--allow-empty", "-qm", "Make updates optional");
    git("tag", "v1.0.3");
    const notes = releaseNotes({ version: "1.0.3", repository: "IAHispano/Applio-App", cwd: directory });
    assert.equal((notes.match(/\/commit\//g) || []).length, 2);
    assert.ok(notes.includes("/compare/v1.0.2...v1.0.3"));
    assert.ok(notes.includes("Fix microphone input"));
    const notesPath = path.join(directory, "notes.md");
    fs.writeFileSync(notesPath, notes);
    for (const name of [
      "Applio_1.0.3_x64.exe",
      "Applio_1.0.3_amd64.AppImage",
      "Applio_1.0.3_x64.app.tar.gz",
      "Applio_1.0.3_aarch64.app.tar.gz",
    ]) {
      fs.writeFileSync(path.join(directory, name), "fixture");
      fs.writeFileSync(path.join(directory, `${name}.sig`), "fixture signature");
    }
    for (const arch of ["arm64", "x64"])
      fs.writeFileSync(path.join(directory, `Applio-1.0.3-macOS-${arch}.zip`), "fixture");
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./collect-tauri-artifacts.mjs", import.meta.url)), "--manifest", directory],
      {
        env: {
          ...process.env,
          RELEASE_VERSION: "1.0.3",
          RELEASE_NOTES_FILE: notesPath,
          GITHUB_REPOSITORY: "IAHispano/Applio-App",
        },
        windowsHide: true,
      },
    );
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "latest.json"), "utf8")).notes, notes);
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("applio-update-notes-"));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test("AppImage media validation rejects a bundle missing WebKit's bad-plugin factories", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "applio-media-fixture-"));
  try {
    const plugins = path.join(directory, "target/release/bundle/appimage/Applio.AppDir/usr/lib/gstreamer-1.0");
    fs.mkdirSync(plugins, { recursive: true });
    for (const name of ["app", "autodetect", "pulseaudio", "playback", "typefindfunctions", "audioconvert", "audioresample", "audioparsers", "flac", "wavparse"])
      fs.writeFileSync(path.join(plugins, `libgst${name}.so`), "fixture");
    assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL("./collect-tauri-artifacts.mjs", import.meta.url)), "--check-appimage-media"], {
      cwd: directory, encoding: "utf8", windowsHide: true, stdio: "pipe",
    }), (error) => /libgstdebugutilsbad\.so/.test(error.stderr));
    fs.writeFileSync(path.join(plugins, "libgstdebugutilsbad.so"), "fixture");
    assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL("./collect-tauri-artifacts.mjs", import.meta.url)), "--check-appimage-media"], {
      cwd: directory, encoding: "utf8", windowsHide: true, stdio: "pipe",
    }), (error) => /libgstsubenc\.so/.test(error.stderr));
    for (const file of ["validate.yml", "release.yml"]) {
      const workflow = fs.readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8");
      assert.ok(workflow.includes("gstreamer1.0-plugins-bad"));
      assert.ok(workflow.includes("gstreamer1.0-tools"));
      assert.ok(workflow.includes("--check-appimage-media"));
    }
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("applio-media-fixture-"));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
