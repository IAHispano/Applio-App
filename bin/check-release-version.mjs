// Check the actual release sync against isolated copies of all version files.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { releaseVersion } from "./release-version.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "applio-versions-"));
const files = [
  "package.json",
  "frontend/web/package.json",
  "frontend/desktop/package.json",
  "assets/config_template.json",
  "frontend/desktop/src-tauri/tauri.conf.json",
  "Cargo.toml",
  "Cargo.lock",
];
function cleanup() {
  if (!path.resolve(root).startsWith(path.join(path.resolve(os.tmpdir()), "applio-versions-")))
    throw new Error("Invalid cleanup root");
  fs.rmSync(root, { recursive: true, force: true });
}
try {
  for (const invalid of [
    "",
    "1.2",
    "1.2.3.4",
    "01.2.3",
    "1.2.3-",
    "1.2.3-beta..1",
    "1.2.3-01",
    "1.2.3+build",
    "1.2.3\nversion=bad",
  ])
    assert.throws(() => releaseVersion(invalid), `Invalid version accepted: ${invalid}`);
  for (const newline of ["\n", "\r\n"]) {
    for (const file of [...files, "bin/sync-version.mjs", "bin/release-version.mjs"]) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, fs.readFileSync(file, "utf8").replace(/\r?\n/g, newline));
    }
    const output = path.join(root, "github-output");
    const sync = (version, prerelease) =>
      spawnSync(process.execPath, ["bin/sync-version.mjs"], {
        cwd: root,
        env: {
          ...process.env,
          RELEASE_VERSION: version,
          RELEASE_PRERELEASE: prerelease,
          GITHUB_OUTPUT: output,
        },
        encoding: "utf8",
        windowsHide: true,
      });
    for (const [input, expected, prerelease] of [
      ["0.2.11", "0.2.11", "false"],
      [" v0.3.0-beta.1 ", "0.3.0-beta.1", "true"],
    ]) {
      fs.writeFileSync(output, "");
      const result = sync(input, prerelease);
      assert.equal(result.status, 0, result.stderr);
      for (const file of files.filter((f) => f.endsWith(".json")))
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, file), "utf8")).version, expected, file);
      const cargo = fs.readFileSync(path.join(root, "Cargo.toml"), "utf8");
      assert.ok(cargo.includes(`version = "${expected}"`));
      const lock = fs.readFileSync(path.join(root, "Cargo.lock"), "utf8");
      for (const name of ["api", "desktop"])
        assert.ok(
          new RegExp(`name = "applio-${name}"\\r?\\nversion = "${expected.replaceAll(".", "\\.")}"`).test(
            lock,
          ),
          `Cargo lock mismatch: ${name}`,
        );
      assert.equal(fs.readFileSync(output, "utf8"), `version=${expected}\ntag=v${expected}\n`);
    }
    const before = files.map((file) => fs.readFileSync(path.join(root, file), "utf8"));
    assert.notEqual(sync("0.3.0-beta.2", "false").status, 0, "Prerelease must require the workflow option");
    assert.notEqual(sync("invalid", "true").status, 0);
    assert.deepEqual(
      files.map((file) => fs.readFileSync(path.join(root, file), "utf8")),
      before,
      "Invalid input changed version files",
    );
  }
  console.log(
    "Release versions passed: all app/Cargo files, normalized tag outputs, prereleases, LF/CRLF and invalid-input preservation.",
  );
} finally {
  cleanup();
}
