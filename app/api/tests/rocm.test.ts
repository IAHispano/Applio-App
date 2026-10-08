import assert from "node:assert/strict";
import test from "node:test";
import { AMD_GPU_ARCH_LIST, getAmdGfxTarget, getAmdGpuArchInfo, gfxToHsaVersion } from "../src/rocm";

test("AMD_GPU_ARCH_LIST contains all 17 documented architectures", () => {
  assert.strictEqual(AMD_GPU_ARCH_LIST.length, 17);

  const targets = new Map(AMD_GPU_ARCH_LIST.map((item) => [item.name, item]));

  assert.strictEqual(targets.get("AMD Radeon RX 9070 / XT")?.gfx, "gfx1201");
  assert.strictEqual(targets.get("AMD Radeon RX 9070 / XT")?.devicePackage, "device-gfx1201");

  assert.strictEqual(targets.get("AMD Radeon RX 9060 / XT")?.gfx, "gfx1200");
  assert.strictEqual(targets.get("AMD Radeon RX 9060 / XT")?.devicePackage, "device-gfx1200");

  assert.strictEqual(targets.get("AMD Radeon 820M iGPU")?.gfx, "gfx1153");
  assert.strictEqual(targets.get("AMD Radeon 820M iGPU")?.devicePackage, "device-gfx1153");

  assert.strictEqual(targets.get("AMD Ryzen AI 7 350")?.gfx, "gfx1152");
  assert.strictEqual(targets.get("AMD Ryzen AI 7 350")?.devicePackage, "device-gfx1152");

  assert.strictEqual(targets.get("AMD Ryzen AI Max+ PRO 395")?.gfx, "gfx1151");
  assert.strictEqual(targets.get("AMD Ryzen AI Max+ PRO 395")?.devicePackage, "device-gfx1151");

  assert.strictEqual(targets.get("AMD Ryzen AI 9 HX 375")?.gfx, "gfx1150");
  assert.strictEqual(targets.get("AMD Ryzen AI 9 HX 375")?.devicePackage, "device-gfx1150");

  assert.strictEqual(targets.get("AMD Ryzen 7 7840U")?.gfx, "gfx1103");
  assert.strictEqual(targets.get("AMD Ryzen 7 7840U")?.devicePackage, "device-gfx1103");

  assert.strictEqual(targets.get("AMD Radeon RX 7600")?.gfx, "gfx1102");
  assert.strictEqual(targets.get("AMD Radeon RX 7600")?.devicePackage, "device-gfx1102");

  assert.strictEqual(targets.get("AMD Radeon RX 7800/7700 XT")?.gfx, "gfx1101");
  assert.strictEqual(targets.get("AMD Radeon RX 7800/7700 XT")?.devicePackage, "device-gfx1101");

  assert.strictEqual(targets.get("AMD Radeon RX 7900 XTX/XT")?.gfx, "gfx1100");
  assert.strictEqual(targets.get("AMD Radeon RX 7900 XTX/XT")?.devicePackage, "device-gfx1100");

  assert.strictEqual(targets.get("AMD Radeon RX 6900/6800 XT")?.gfx, "gfx1030");
  assert.strictEqual(targets.get("AMD Radeon RX 6900/6800 XT")?.devicePackage, "device-gfx1030");

  assert.strictEqual(targets.get("AMD Radeon RX 6750/6700 XT")?.gfx, "gfx1031");
  assert.strictEqual(targets.get("AMD Radeon RX 6750/6700 XT")?.devicePackage, "device-gfx1031");

  assert.strictEqual(targets.get("AMD Radeon RX 6600 XT")?.gfx, "gfx1032");
  assert.strictEqual(targets.get("AMD Radeon RX 6600 XT")?.devicePackage, "device-gfx1032");

  assert.strictEqual(targets.get("AMD Radeon RX 6500 XT")?.gfx, "gfx1034");
  assert.strictEqual(targets.get("AMD Radeon RX 6500 XT")?.devicePackage, "device-gfx1034");

  assert.strictEqual(targets.get("AMD Radeon 680M iGPU")?.gfx, "gfx1035");
  assert.strictEqual(targets.get("AMD Radeon 680M iGPU")?.devicePackage, "device-gfx1035");

  assert.strictEqual(targets.get("AMD Raphael iGPU")?.gfx, "gfx1036");
  assert.strictEqual(targets.get("AMD Raphael iGPU")?.devicePackage, "device-gfx1036");

  assert.strictEqual(targets.get("AMD Radeon RX 5700 / XT")?.gfx, "gfx1010");
  assert.strictEqual(targets.get("AMD Radeon RX 5700 / XT")?.devicePackage, "device-gfx1010");
});

test("getAmdGfxTarget maps each marketing name correctly", () => {
  const expectations: Array<[string, string]> = [
    ["AMD Radeon RX 9070 / XT", "gfx1201"],
    ["AMD Radeon RX 9070", "gfx1201"],
    ["AMD Radeon RX 9070 XT", "gfx1201"],
    ["AMD Radeon RX 9060 / XT", "gfx1200"],
    ["AMD Radeon RX 9060", "gfx1200"],
    ["AMD Radeon RX 9060 XT", "gfx1200"],
    ["AMD Radeon 820M iGPU", "gfx1153"],
    ["AMD Ryzen AI 7 350", "gfx1152"],
    ["AMD Ryzen AI 7 PRO 350", "gfx1152"],
    ["AMD Ryzen AI Max+ PRO 395", "gfx1151"],
    ["AMD Ryzen AI Max+ 395", "gfx1151"],
    ["AMD Ryzen AI 9 HX 375", "gfx1150"],
    ["AMD Ryzen AI 9 HX 370", "gfx1150"],
    ["AMD Radeon 890M", "gfx1150"],
    ["AMD Ryzen 7 7840U", "gfx1103"],
    ["AMD Ryzen 7 7840HS", "gfx1103"],
    ["AMD Radeon 780M Graphics", "gfx1103"],
    ["AMD Radeon RX 7600", "gfx1102"],
    ["AMD Radeon RX 7600 XT", "gfx1102"],
    ["AMD Radeon RX 7800 XT", "gfx1101"],
    ["AMD Radeon RX 7700 XT", "gfx1101"],
    ["AMD Radeon RX 7900 XTX", "gfx1100"],
    ["AMD Radeon RX 7900 XT", "gfx1100"],
    ["AMD Radeon RX 6900 XT", "gfx1030"],
    ["AMD Radeon RX 6800 XT", "gfx1030"],
    ["AMD Radeon RX 6750 XT", "gfx1031"],
    ["AMD Radeon RX 6700 XT", "gfx1031"],
    ["AMD Radeon RX 6600 XT", "gfx1032"],
    ["AMD Radeon RX 6500 XT", "gfx1034"],
    ["AMD Radeon 680M iGPU", "gfx1035"],
    ["AMD Raphael iGPU", "gfx1036"],
    ["AMD Radeon RX 5700 XT", "gfx1010"],
    ["AMD Radeon RX 5700", "gfx1010"],
  ];

  for (const [name, expectedGfx] of expectations) {
    const target = getAmdGfxTarget(name);
    assert.strictEqual(target, expectedGfx, `Expected ${name} to map to ${expectedGfx}, got ${target}`);
  }
});

test("getAmdGfxTarget matches direct gfx and device-gfx strings", () => {
  assert.strictEqual(getAmdGfxTarget("gfx1201"), "gfx1201");
  assert.strictEqual(getAmdGfxTarget("device-gfx1201"), "gfx1201");
  assert.strictEqual(getAmdGfxTarget("AMD Radeon RX 9070 / XT gfx1201 device-gfx1201"), "gfx1201");
  assert.strictEqual(getAmdGfxTarget("device-gfx1153"), "gfx1153");
  assert.strictEqual(getAmdGfxTarget("gfx1150"), "gfx1150");
});

test("gfxToHsaVersion converts gfx targets to correct HSA triplets", () => {
  assert.strictEqual(gfxToHsaVersion("gfx1201"), "12.0.1");
  assert.strictEqual(gfxToHsaVersion("gfx1200"), "12.0.0");
  assert.strictEqual(gfxToHsaVersion("gfx1153"), "11.5.3");
  assert.strictEqual(gfxToHsaVersion("gfx1152"), "11.5.2");
  assert.strictEqual(gfxToHsaVersion("gfx1151"), "11.5.1");
  assert.strictEqual(gfxToHsaVersion("gfx1150"), "11.5.0");
  assert.strictEqual(gfxToHsaVersion("gfx1103"), "11.0.3");
  assert.strictEqual(gfxToHsaVersion("gfx1102"), "11.0.2");
  assert.strictEqual(gfxToHsaVersion("gfx1101"), "11.0.1");
  assert.strictEqual(gfxToHsaVersion("gfx1100"), "11.0.0");
  assert.strictEqual(gfxToHsaVersion("gfx1036"), "10.3.6");
  assert.strictEqual(gfxToHsaVersion("gfx1035"), "10.3.5");
  assert.strictEqual(gfxToHsaVersion("gfx1034"), "10.3.4");
  assert.strictEqual(gfxToHsaVersion("gfx1032"), "10.3.2");
  assert.strictEqual(gfxToHsaVersion("gfx1031"), "10.3.1");
  assert.strictEqual(gfxToHsaVersion("gfx1030"), "10.3.0");
  assert.strictEqual(gfxToHsaVersion("gfx1010"), "10.1.0");
  assert.strictEqual(gfxToHsaVersion("gfx908"), "9.0.8");
  assert.strictEqual(gfxToHsaVersion("gfx90a"), null);
});

test("getAmdGpuArchInfo retrieves structured metadata", () => {
  const info = getAmdGpuArchInfo("AMD Radeon RX 9070 / XT");
  assert.ok(info);
  assert.strictEqual(info.gfx, "gfx1201");
  assert.strictEqual(info.devicePackage, "device-gfx1201");
  assert.strictEqual(info.hsaVersion, "12.0.1");
});
