// Exercise both Tauri and Electron update feeds without publishing a release.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "applio-feeds-"));
const version = "0.2.10";
const env = { ...process.env, RELEASE_VERSION: `v${version}` };
const collect = () =>
  spawnSync(process.execPath, ["bin/collect-tauri-artifacts.mjs", "--manifest", temporary], {
    env,
    encoding: "utf8",
    windowsHide: true,
  });
function cleanup() {
  if (!temporary.startsWith(path.join(os.tmpdir(), "applio-feeds-")))
    throw new Error("Invalid test cleanup root");
  fs.rmSync(temporary, { recursive: true, force: true });
}
try {
  assert.notEqual(collect().status, 0, "Empty release must fail");
  for (const filename of [
    "Applio_0.2.10_x64-setup.exe",
    "Applio_0.2.10_amd64.AppImage",
    "Applio-0.2.10-macOS-arm64.app.tar.gz",
    "Applio-0.2.10-macOS-x64.app.tar.gz",
    "Applio_0.2.100_x64-setup.exe",
    "Applio_0.2.10-beta.1_x64-setup.exe",
  ]) {
    fs.writeFileSync(path.join(temporary, filename), filename);
    fs.writeFileSync(path.join(temporary, `${filename}.sig`), `signature-${filename}`);
  }
  const result = collect();
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(temporary, "latest.json"), "utf8"));
  assert.equal(manifest.version, version);
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [
    "darwin-aarch64",
    "darwin-x86_64",
    "linux-x86_64",
    "windows-x86_64",
  ]);
  for (const release of Object.values(manifest.platforms)) {
    const filename = decodeURIComponent(new URL(release.url).pathname.split("/").pop());
    assert.ok(!filename.includes("0.2.100") && !filename.includes("beta"));
    assert.equal(release.signature, `signature-${filename}`);
    assert.ok(release.url.includes(`/v${version}/`));
  }
  for (const feedName of ["latest.yml", "latest-linux.yml"]) {
    // JSON is a valid YAML document understood by Electron's YAML parser.
    const feed = JSON.parse(fs.readFileSync(path.join(temporary, feedName), "utf8"));
    const bytes = fs.readFileSync(path.join(temporary, feed.path));
    assert.equal(feed.version, version);
    assert.equal(feed.sha512, createHash("sha512").update(bytes).digest("base64"));
    assert.deepEqual(feed.files, [{ url: feed.path, sha512: feed.sha512, size: bytes.length }]);
  }
  fs.writeFileSync(path.join(temporary, "Duplicate_0.2.10_x64.exe"), "duplicate");
  fs.writeFileSync(path.join(temporary, "Duplicate_0.2.10_x64.exe.sig"), "duplicate");
  assert.notEqual(collect().status, 0, "Ambiguous platform artifacts must fail");
  console.log(
    "Update feeds passed: platform selection, exact version, Electron checksums, empty/duplicate rejection.",
  );
} finally {
  cleanup();
}
