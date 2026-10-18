import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { releaseVersion } from "./release-version.mjs";

const manifestIndex = process.argv.indexOf("--manifest");
if (manifestIndex >= 0) {
  const directory = path.resolve(process.argv[manifestIndex + 1]);
  const version = releaseVersion(process.env.RELEASE_VERSION);
  const repository = process.env.GITHUB_REPOSITORY || "IAHispano/Applio-App";
  const platforms = {};
  const legacy = {};
  const macFiles = [];
  for (const filename of fs.readdirSync(directory)) {
    if (!hasVersion(filename, version)) continue;
    if (/-macOS-(arm64|x64)\.zip$/.test(filename)) {
      macFiles.push(fileInfo(directory, filename));
      continue;
    }
    if (!filename.endsWith(".sig")) continue;
    const artifact = filename.slice(0, -4);
    if (!fs.existsSync(path.join(directory, artifact)))
      throw new Error(`Missing signed artifact: ${artifact}`);
    const os = artifact.endsWith(".exe")
      ? "windows"
      : artifact.endsWith(".AppImage")
        ? "linux"
        : artifact.endsWith(".app.tar.gz")
          ? "darwin"
          : null;
    if (!os) continue;
    const arch = /(?:aarch64|arm64)/i.test(artifact) ? "aarch64" : "x86_64";
    if (platforms[`${os}-${arch}`]) throw new Error(`Duplicate updater artifact for ${os}-${arch}`);
    platforms[`${os}-${arch}`] = {
      signature: fs.readFileSync(path.join(directory, filename), "utf8").trim(),
      url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(artifact)}`,
    };
    // Electron clients need their own checksum feed for the first transition.
    // Windows NSIS receives /D from the old updater; Linux replaces AppImages.
    if ((os === "windows" || os === "linux") && arch === "x86_64") {
      const file = fileInfo(directory, artifact);
      legacy[os === "windows" ? "latest.yml" : "latest-linux.yml"] = {
        version,
        files: [file],
        path: artifact,
        sha512: file.sha512,
        releaseDate: new Date().toISOString(),
      };
    }
  }
  for (const platform of ["windows-x86_64", "linux-x86_64", "darwin-x86_64", "darwin-aarch64"]) {
    if (!platforms[platform]) throw new Error(`Missing signed updater artifact for ${platform}`);
  }
  for (const arch of ["x64", "arm64"]) {
    if (!macFiles.some((file) => file.url.endsWith(`-macOS-${arch}.zip`)))
      throw new Error(`Missing Electron migration ZIP for macOS ${arch}`);
  }
  // Older MacUpdater clients select the matching architecture from files[]
  // and require ZIPs containing the application bundle, not Tauri tarballs.
  macFiles.sort((a, b) => a.url.localeCompare(b.url));
  legacy["latest-mac.yml"] = {
    version,
    files: macFiles,
    path: macFiles[0].url,
    sha512: macFiles[0].sha512,
    releaseDate: new Date().toISOString(),
  };
  if (Object.keys(platforms).length) {
    const notes = process.env.RELEASE_NOTES_FILE
      ? fs.readFileSync(process.env.RELEASE_NOTES_FILE, "utf8")
      : `Applio ${version}\n\nRelease notes: https://github.com/${repository}/releases/tag/v${version}`;
    fs.writeFileSync(
      path.join(directory, "latest.json"),
      `${JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2)}\n`,
    );
    // JSON is valid YAML, and avoids a separate YAML serializer dependency.
    for (const [name, feed] of Object.entries(legacy))
      fs.writeFileSync(path.join(directory, name), `${JSON.stringify(feed, null, 2)}\n`);
  } else throw new Error("No signed artifacts for this version; refusing to generate an update feed.");
} else {
  const source = path.resolve("target/release/bundle");
  const destination = path.resolve("frontend/desktop/dist-installers");
  fs.mkdirSync(destination, { recursive: true });
  const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name.endsWith(".app") && process.platform === "darwin") {
        const zip = path.join(destination, `Applio-${version}-macOS-${process.arch}.zip`);
        execFileSync("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", file, zip]);
        console.log(`Collected ${path.basename(zip)}`);
      } else if (entry.isDirectory() && !entry.name.endsWith(".app")) walk(file);
      else if (entry.isFile() && /\.(exe|dmg|AppImage|deb|app\.tar\.gz)(\.sig)?$/.test(entry.name)) {
        if (!/\.app\.tar\.gz(\.sig)?$/.test(entry.name) && !hasVersion(entry.name, version)) continue;
        const name = /\.app\.tar\.gz(\.sig)?$/.test(entry.name)
          ? `Applio-${version}-macOS-${process.arch}.app.tar.gz${entry.name.endsWith(".sig") ? ".sig" : ""}`
          : entry.name;
        fs.copyFileSync(file, path.join(destination, name));
        console.log(`Collected ${name}`);
      }
    }
  }
  walk(source);
}

function fileInfo(directory, filename) {
  const bytes = fs.readFileSync(path.join(directory, filename));
  return { url: filename, sha512: createHash("sha512").update(bytes).digest("base64"), size: bytes.length };
}

function hasVersion(filename, version) {
  return filename
    .split(version)
    .some(
      (prefix, index, parts) =>
        index < parts.length - 1 &&
        !/\d$/.test(prefix) &&
        /^(?:[_-](?:x64|x86_64|aarch64|arm64|amd64|macOS)(?:[_.-]|$)|\.(?:exe|dmg|AppImage|deb|zip|app\.tar\.gz)(?:\.sig)?$)/.test(
          parts[index + 1],
        ),
    );
}
