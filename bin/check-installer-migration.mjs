// Exercise the actual NSIS migration macros against disposable files/registry
// entries. Never install over or uninstall the user's application.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32") throw new Error("Windows NSIS check only");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "applio-migration-"));
const registry = `Software\\ApplioMigrationQA\\${randomUUID()}`;
const compiler = path.join(process.env.LOCALAPPDATA, "tauri/NSIS/makensis.exe");
const hooks = path.resolve("frontend/desktop/src-tauri/installer-hooks.nsh");
const quote = (value) => value.replaceAll('"', '$\\"');
try {
  for (const scenario of ["default", "explicit", "backup-conflict", "unsafe-folder"]) {
    const directory = path.join(temporary, scenario);
    const old = path.join(directory, "old-install");
    const custom = path.join(directory, "chosen-install");
    fs.mkdirSync(path.join(old, "resources/app"), { recursive: true });
    fs.mkdirSync(path.join(old, "data/runtime/.venv"), { recursive: true });
    fs.mkdirSync(custom, { recursive: true });
    for (const name of ["Applio.exe", "Uninstall Applio.exe", "chrome_100_percent.pak"])
      fs.writeFileSync(path.join(old, name), `original ${name}`);
    fs.writeFileSync(path.join(old, "resources/app/package.json"), '{"name":"@applio/desktop"}');
    fs.writeFileSync(
      path.join(old, "data/config.json"),
      '{"logs_dir":"custom-voices","theme":{"file":"dark.json"}}',
    );
    fs.writeFileSync(path.join(old, "data/runtime/.venv/python-sentinel"), "existing environment");
    fs.writeFileSync(path.join(old, "user-notes.txt"), "keep unrelated user files");
    if (scenario === "backup-conflict") {
      fs.mkdirSync(path.join(old, ".electron-backup/resources"), { recursive: true });
      fs.writeFileSync(path.join(old, ".electron-backup/resources/previous"), "previous backup");
    }
    const target =
      scenario === "default"
        ? "$LOCALAPPDATA\\ApplioMigrationQA"
        : scenario === "explicit"
          ? custom
          : scenario === "unsafe-folder"
            ? "$PROFILE"
            : old;
    const source = path.join(directory, "migration.nsi");
    const executable = path.join(directory, "migration.exe");
    fs.writeFileSync(
      source,
      [
        "Unicode true",
        "RequestExecutionLevel user",
        "SilentInstall silent",
        `OutFile "${quote(executable)}"`,
        '!define APPLIO_DEFAULT_INSTALL_NAME "ApplioMigrationQA"',
        `!define APPLIO_TAURI_PRODUCT_KEY "${registry}\\new"`,
        '!define MAINBINARYNAME "applio-desktop"',
        `!define MANUPRODUCTKEY "${registry}\\new"`,
        `!define APPLIO_LEGACY_UNINSTALL_KEY "${registry}\\old"`,
        "Var PassiveMode",
        "!macro CheckIfAppIsRunning executable product",
        "!macroend",
        `!include "${quote(hooks)}"`,
        '!define PRODUCTNAME "ApplioMigrationQA"',
        "Section",
        `WriteRegStr HKCU "${registry}\\old" "UninstallString" '$\\"${quote(old)}\\Uninstall Applio.exe$\\" /currentuser'`,
        `StrCpy $INSTDIR "${quote(target)}"`,
        "!insertmacro NSIS_HOOK_PREINSTALL",
        ...(scenario === "unsafe-folder"
          ? ["SetErrorLevel 99", "Quit"]
          : [
              'CreateDirectory "$INSTDIR"',
              'FileOpen $R0 "$INSTDIR\\applio-desktop.exe" w',
              'FileWrite $R0 "new native app"',
              "FileClose $R0",
              "!insertmacro NSIS_HOOK_POSTINSTALL",
            ]),
        "SectionEnd",
        "",
      ].join("\n"),
    );
    execFileSync(compiler, ["/V2", source], { windowsHide: true, stdio: "pipe" });
    let status = 0;
    try {
      execFileSync(executable, [], { windowsHide: true, stdio: "pipe", timeout: 20000 });
    } catch (error) {
      status = error.status;
    }
    if (scenario === "unsafe-folder") {
      assert.notEqual(status, 0);
      assert.notEqual(status, 99, "Unsafe target must abort before installation");
    } else if (scenario === "backup-conflict") {
      assert.notEqual(status, 0);
      assert.ok(fs.existsSync(path.join(old, "resources/app/package.json")));
      assert.equal(
        fs.readFileSync(path.join(old, ".electron-backup/resources/previous"), "utf8"),
        "previous backup",
      );
    } else if (scenario === "explicit") {
      assert.equal(status, 0);
      assert.ok(fs.existsSync(path.join(custom, "applio-desktop.exe")));
      assert.ok(fs.existsSync(path.join(old, "Applio.exe")), "Separate install must retain Electron");
    } else {
      assert.equal(status, 0);
      assert.ok(fs.existsSync(path.join(old, "applio-desktop.exe")));
      assert.ok(!fs.existsSync(path.join(old, "Applio.exe")));
      assert.equal(
        fs.readFileSync(path.join(old, ".electron-backup/Applio.exe"), "utf8"),
        "original Applio.exe",
      );
      assert.ok(fs.existsSync(path.join(old, ".electron-backup/resources/app/package.json")));
      assert.throws(() => execFileSync("reg.exe", ["query", `HKCU\\${registry}\\old`], { stdio: "pipe" }));
    }
    assert.equal(
      fs.readFileSync(path.join(old, "data/config.json"), "utf8"),
      '{"logs_dir":"custom-voices","theme":{"file":"dark.json"}}',
    );
    assert.equal(
      fs.readFileSync(path.join(old, "data/runtime/.venv/python-sentinel"), "utf8"),
      "existing environment",
    );
    assert.equal(fs.readFileSync(path.join(old, "user-notes.txt"), "utf8"), "keep unrelated user files");
    console.log(`NSIS migration passed: ${scenario}`);
    execFileSync("reg.exe", ["delete", `HKCU\\${registry}`, "/f"], { stdio: "ignore" });
  }
} finally {
  try {
    execFileSync("reg.exe", ["delete", `HKCU\\${registry}`, "/f"], { stdio: "ignore" });
  } catch {}
  cleanTemporary();
}
function cleanTemporary() {
  // A task-created unique temporary directory; do not follow any user paths.
  if (!temporary.startsWith(path.join(os.tmpdir(), "applio-migration-")))
    throw new Error("Invalid cleanup root");
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5 });
}
