import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { releaseVersion } from "./release-version.mjs";

export function releaseNotes({ version, repository, cwd = process.cwd() }) {
  const next = releaseVersion(version);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid GitHub repository");
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
  let previous;
  try {
    previous = git("describe", "--tags", "--abbrev=0", `--exclude=v${next}`);
  } catch {
    // A first release has no preceding tag.
  }
  const root = `https://github.com/${repository}`;
  const range = previous ? `${previous}..HEAD` : "HEAD";
  const commits = git("log", range, "--format=%H%x09%h%x09%s").split("\n").filter(Boolean);
  const lines = commits.map((line) => {
    const [sha, short, ...subject] = line.split("\t");
    const title = subject.join(" ").replace(/[\\`*_{}[\]<>]/g, "");
    return `- [${short}](${root}/commit/${sha}) ${title}`;
  });
  return [
    `## Changes in v${next}`,
    ...(previous
      ? [`[Compare all changes](${root}/compare/${encodeURIComponent(previous)}...v${next})`]
      : []),
    "",
    ...lines,
    "",
    "### macOS first launch",
    'The app is not Apple-notarized yet. If macOS reports Applio is "damaged", run `xattr -cr /Applications/Applio.app` and open it again.',
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.RELEASE_NOTES_FILE) throw new Error("RELEASE_NOTES_FILE is required");
  fs.writeFileSync(
    process.env.RELEASE_NOTES_FILE,
    releaseNotes({
      version: process.env.RELEASE_VERSION,
      repository: process.env.GITHUB_REPOSITORY || "IAHispano/Applio-App",
    }),
  );
}
