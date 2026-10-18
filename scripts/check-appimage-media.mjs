import assert from "node:assert/strict";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

// AppRun uses bundled plugins: host-installed plugins cannot fill these gaps.
const root = path.resolve("target/release/bundle/appimage/Applio.AppDir");
for (const name of ["libgstapp.so", "libgstautodetect.so", "libgstpulseaudio.so"]) {
  assert.ok(statSync(path.join(root, "usr/lib/gstreamer-1.0", name)).size > 0, name);
}
accessSync(path.join(root, "usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"), constants.X_OK);
assert.ok(statSync(path.join(root, "apprun-hooks/linuxdeploy-plugin-gstreamer.sh")).size > 0);
console.log("AppImage media plugins, scanner, and AppRun hook are present.");
