import fs from "node:fs";
import path from "node:path";

const manifestIndex = process.argv.indexOf("--manifest");
if (manifestIndex >= 0) {
  const directory = path.resolve(process.argv[manifestIndex + 1]);
  const version = (process.env.RELEASE_VERSION || "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error("Invalid release version");
  const repository = process.env.GITHUB_REPOSITORY || "IAHispano/Applio-App";
  const platforms = {};
  for (const filename of fs.readdirSync(directory)) {
    if (!filename.endsWith(".sig")) continue;
    const artifact = filename.slice(0, -4);
    if (!fs.existsSync(path.join(directory, artifact))) throw new Error(`Missing signed artifact: ${artifact}`);
    const os = artifact.endsWith(".exe") ? "windows" : artifact.endsWith(".AppImage") ? "linux" : artifact.endsWith(".app.tar.gz") ? "darwin" : null;
    if (!os) continue;
    const arch = /(?:aarch64|arm64)/i.test(artifact) ? "aarch64" : "x86_64";
    platforms[`${os}-${arch}`] = {
      signature: fs.readFileSync(path.join(directory, filename), "utf8").trim(),
      url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(artifact)}`,
    };
  }
  if (Object.keys(platforms).length) {
    fs.writeFileSync(path.join(directory, "latest.json"), `${JSON.stringify({ version, notes: `Applio ${version}`, pub_date: new Date().toISOString(), platforms }, null, 2)}\n`);
  } else console.log("Unsigned release: no automatic updater manifest generated.");
} else {
  const source = path.resolve("target/release/bundle");
  const destination = path.resolve("frontend/desktop/dist-installers");
  fs.mkdirSync(destination, { recursive: true });
  const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.name.endsWith(".app")) walk(file);
      else if (entry.isFile() && /\.(exe|dmg|AppImage|deb|app\.tar\.gz)(\.sig)?$/.test(entry.name)) {
        const name = /\.app\.tar\.gz(\.sig)?$/.test(entry.name)
          ? `Applio-${version}-macOS-${process.arch}.app.tar.gz${entry.name.endsWith(".sig") ? ".sig" : ""}` : entry.name;
        fs.copyFileSync(file, path.join(destination, name));
        console.log(`Collected ${name}`);
      }
    }
  }
  walk(source);
}
