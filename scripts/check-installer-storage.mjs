// Compile a minimal installer using the real removal hook and builder's
// atomic file helpers. No production installation or AppData is touched.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nsis = process.env.MAKENSIS || path.join(process.env.LOCALAPPDATA || "", "electron-builder/Cache/nsis/nsis-3.0.4.1/makensis.exe");
assert.ok(fs.existsSync(nsis), "Set MAKENSIS to the makensis.exe used by electron-builder.");
const builder = fs.readdirSync(path.join(root, "node_modules/.pnpm")).find(n => n.startsWith("app-builder-lib@"));
const template = fs.readFileSync(path.join(root, "node_modules/.pnpm", builder, "node_modules/app-builder-lib/templates/nsis/uninstaller.nsh"), "utf8");
const helpers = ["atomicRMDir", "restoreFiles"].map(name => template.match(new RegExp(`Function un\\.${name}[\\s\\S]*?FunctionEnd`))[0]).join("\n");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "applio-installer-"));
try {
  const target = path.join(temporary, "Selected Folder");
  const installer = path.join(temporary, "setup.exe");
  const script = path.join(temporary, "storage.nsi");
  fs.writeFileSync(script, `Unicode true
Name "Applio storage regression"
OutFile "${installer}"
InstallDir "${target}"
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
!define UNINSTALL_FILENAME "Uninstall.exe"
!include "${path.join(root, "frontend/desktop/build/installer.nsh")}"
${helpers}
Section
SetOutPath "$INSTDIR"
WriteUninstaller "$INSTDIR\\Uninstall.exe"
SectionEnd
Section "Uninstall"
!insertmacro customRemoveFiles
SectionEnd
`);
  const compiled = spawnSync(nsis, ["/V2", script], { encoding: "utf8" });
  assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);
  assert.equal(spawnSync(installer).status, 0);
  fs.mkdirSync(path.join(target, "data/runtime/logs/voice"), { recursive: true });
  fs.mkdirSync(path.join(target, "logs/legacy"), { recursive: true });
  fs.mkdirSync(path.join(target, "resources/app"), { recursive: true });
  const model = path.join(target, "data/runtime/logs/voice/voice.pth");
  const legacy = path.join(target, "logs/legacy/checkpoint.pth");
  const config = path.join(target, "data/config.json");
  fs.writeFileSync(model, "trained voice"); fs.writeFileSync(legacy, "legacy voice");
  fs.writeFileSync(config, '{"language":"fr_FR"}');
  fs.writeFileSync(path.join(target, "resources/app/old.js"), "old application code");
  fs.writeFileSync(path.join(target, "my-recording.wav"), "user recording");
  // NSIS requires _?= to be the unquoted final argument, including spaces.
  const removed = spawnSync(path.join(target, "Uninstall.exe"), ["/S", "_?=" + target], { encoding: "utf8", windowsVerbatimArguments: true });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.readFileSync(model, "utf8"), "trained voice");
  assert.equal(fs.readFileSync(legacy, "utf8"), "legacy voice");
  assert.equal(fs.readFileSync(config, "utf8"), '{"language":"fr_FR"}');
  assert.ok(!fs.existsSync(path.join(target, "resources")));
  assert.equal(fs.readFileSync(path.join(target, "my-recording.wav"), "utf8"), "user recording");
  assert.equal(spawnSync(installer).status, 0);
  assert.equal(fs.readFileSync(model, "utf8"), "trained voice", "Installing the next version must preserve models");
  fs.mkdirSync(path.join(target, "resources/app"), { recursive: true });
  const first = path.join(target, "resources/app/a.js");
  const locked = path.join(target, "resources/app/b.js");
  fs.writeFileSync(first, "first file"); fs.writeFileSync(locked, "locked file");
  const psPath = locked.replaceAll("'", "''");
  const command = `$handle = [IO.File]::Open('${psPath}', 'Open', 'Read', 'None'); [Console]::WriteLine('READY'); [Console]::ReadLine() | Out-Null; $handle.Dispose()`;
  const locker = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], { windowsHide: true });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("File lock did not become ready")), 10000);
      locker.stdout.on("data", chunk => { if (chunk.toString().includes("READY")) { clearTimeout(timer); resolve(); } });
      locker.once("error", error => { clearTimeout(timer); reject(error); });
    });
    const failed = spawnSync(path.join(target, "Uninstall.exe"), ["/S", "_?=" + target], { windowsVerbatimArguments: true });
    assert.notEqual(failed.status, 0, "Busy application files must abort removal");
    assert.equal(fs.readFileSync(first, "utf8"), "first file", "Already moved application files must be restored");
    assert.ok(fs.existsSync(locked));
    assert.equal(fs.readFileSync(model, "utf8"), "trained voice");
  } finally {
    const closed = new Promise(resolve => locker.once("close", resolve));
    locker.stdin.end("\n");
    await closed;
  }
  assert.equal(fs.readFileSync(locked, "utf8"), "locked file");
  console.log("NSIS removal/reinstallation and locked-file rollback preserve models, preferences, legacy logs and unrelated files.");
} finally {
  // All paths are fixed descendants of this newly created temporary workspace.
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(temporary, { recursive: true, force: true });
}
