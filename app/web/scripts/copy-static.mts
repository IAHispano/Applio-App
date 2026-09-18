// Post-build: copy client static assets + public dir next to the standalone
// server (Next.js omits them from standalone output). Run from app/web.
// Compatible with both npm (flat node_modules, real dirs) and pnpm
// (symlinked node_modules, standalone tracing can leave broken symlinks).
// Docs (verified with Playwright, HTTP 200):
// - Next.js standalone: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
// - pnpm symlinks: https://pnpm.io/motivation
// - electron-builder FileSet: https://www.electron.build/docs/api/app-builder-lib.interface.fileset/
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const webDir: string = path.resolve(import.meta.dirname, "..");
const repoRoot: string = path.resolve(webDir, "..", "..");
const standaloneDir: string = path.join(webDir, ".next", "standalone");

// Detect package-manager layout for logging (best-effort, never fails build).
function detectLayout(rootModules: string): "pnpm" | "npm" | "unknown" {
  // Mixed installs happen (npm + pnpm in same repo): .pnpm store wins.
  if (fs.existsSync(path.join(rootModules, ".pnpm"))) return "pnpm";
  try {
    const probe = path.join(rootModules, "react");
    const st = fs.lstatSync(probe, { throwIfNoEntry: false });
    if (st?.isSymbolicLink()) return "pnpm";
    if (st?.isDirectory()) return "npm";
  } catch {
    // ignore
  }
  return "unknown";
}

function ensureDir(dest: string): void {
  const st = fs.lstatSync(dest, { throwIfNoEntry: false });
  // A (possibly broken) symlink blocks mkdirSync with ENOENT/EEXIST.
  if (st?.isSymbolicLink()) fs.unlinkSync(dest);
  fs.mkdirSync(dest, { recursive: true });
}

function copyDir(src: string, dest: string): void {
  // Dereference src in case the caller passes a symlinked path (pnpm).
  let realSrc = src;
  const srcStat = fs.lstatSync(src, { throwIfNoEntry: false });
  if (!srcStat) return;
  if (srcStat.isSymbolicLink()) {
    try {
      realSrc = fs.realpathSync(src);
    } catch {
      console.warn(`[copy-static] skipping broken symlink src: ${src}`);
      return;
    }
  }
  if (!fs.existsSync(realSrc)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(realSrc, { withFileTypes: true })) {
    const from = path.join(realSrc, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      // Dereference (cp -rL equivalent): copy real file/dir, never the link.
      // Required for Electron AppImage: links pointing to ../../.pnpm break.
      let realFrom: string;
      try {
        realFrom = fs.realpathSync(from);
      } catch {
        console.warn(`[copy-static] skipping broken symlink: ${from}`);
        continue;
      }
      const realStat = fs.statSync(realFrom);
      if (realStat.isDirectory()) copyDir(realFrom, to);
      else {
        ensureDir(path.dirname(to));
        fs.copyFileSync(realFrom, to);
      }
    } else if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

if (!fs.existsSync(standaloneDir)) {
  console.log("[copy-static] no standalone output, skipping");
  process.exit(0);
}

// 1. Copy static assets and public directory
copyDir(path.join(webDir, ".next", "static"), path.join(standaloneDir, ".next", "static"));
copyDir(path.join(webDir, "public"), path.join(standaloneDir, "public"));

// 2. Ensure hoisted monorepo dependencies are present as REAL dirs in standalone.
const standaloneModules = path.join(standaloneDir, "node_modules");
const rootModules = path.join(repoRoot, "node_modules");
const webModules = path.join(webDir, "node_modules");
console.log(`[copy-static] layout: ${detectLayout(rootModules)}`);
ensureDir(standaloneModules);

// Resolve a package directory, npm/pnpm compatible. `fromPkgJson` is the
// package.json of the dependent, so Node resolves transitive deps through
// the dependent's own node_modules — including pnpm's isolated .pnpm store,
// where transitive deps are NOT hoisted to app/web/node_modules.
function resolvePkgDir(dep: string, fromPkgJson: string): string | null {
  // Fast path: hoisted or directly-symlinked locations (npm flat, pnpm direct).
  for (const base of [webModules, rootModules]) {
    const dir = path.join(base, dep);
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
  }
  // Parent-relative resolution for pnpm-isolated transitive deps.
  // realpath first: under pnpm the parent itself is a symlink into the
  // .pnpm store, and only the real location has the dep symlinks next to it.
  try {
    const realParent = fs.realpathSync(fromPkgJson);
    const main = createRequire(realParent).resolve(dep);
    let dir = path.dirname(main);
    for (let i = 0; i < 8; i++) {
      const pj = path.join(dir, "package.json");
      if (fs.existsSync(pj)) {
        try {
          if ((JSON.parse(fs.readFileSync(pj, "utf8")) as { name?: string }).name === dep) return dir;
        } catch {
          // unreadable manifest, keep walking up
        }
      }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  } catch {
    // unresolvable from this parent
  }
  return null;
}

// Full Next runtime closure: Map dep -> source dir. BFS from the web root so
// every transitive dep resolves relative to its actual dependent.
function runtimeClosure(): Map<string, string> {
  const found = new Map<string, string>();
  const webPkgJson = path.join(webDir, "package.json");
  const queue: Array<{ dep: string; from: string }> = [
    { dep: "react", from: webPkgJson },
    { dep: "react-dom", from: webPkgJson },
    { dep: "next", from: webPkgJson },
  ];
  while (queue.length > 0) {
    const next = queue.pop();
    if (!next || found.has(next.dep)) continue;
    const { dep, from } = next;
    const src = resolvePkgDir(dep, from);
    if (!src) {
      console.warn(`[copy-static] could not locate ${dep} (required by ${from}), skipping`);
      continue;
    }
    found.set(dep, src);
    let pkg: { dependencies?: Record<string, string> };
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
    } catch {
      continue;
    }
    for (const sub of Object.keys(pkg.dependencies ?? {})) {
      if (!found.has(sub)) queue.push({ dep: sub, from: path.join(src, "package.json") });
    }
  }
  return found;
}

function ensureRealDep(dep: string, src: string): void {
  const target = path.join(standaloneModules, dep);
  const targetStat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (targetStat?.isSymbolicLink()) {
    // Broken or valid link -> replace with real copy for Electron/Docker.
    const resolves = fs.existsSync(target); // follows link
    console.log(`[copy-static] replacing ${resolves ? "symlink" : "broken symlink"} ${dep}`);
    fs.unlinkSync(target);
  }
  if (!fs.existsSync(target)) {
    console.log(`[copy-static] copying ${dep} to standalone/node_modules/${dep}`);
    copyDir(src, target);
  }
}

const closure = runtimeClosure();

// 2a. Repair any broken symlink Next tracing left behind (pnpm layout).
for (const entry of fs.readdirSync(standaloneModules, { withFileTypes: true })) {
  if (!entry.isSymbolicLink()) continue;
  const full = path.join(standaloneModules, entry.name);
  if (fs.existsSync(full)) continue;
  console.log(`[copy-static] found broken symlink: ${entry.name}`);
  const src = closure.get(entry.name);
  if (!src) {
    console.warn(`[copy-static] no source found for ${entry.name}, leaving as-is`);
    continue;
  }
  ensureRealDep(entry.name, src);
}

// 2b. Ensure full runtime closure as real dirs (npm flat + pnpm).
for (const [dep, src] of closure) ensureRealDep(dep, src);

console.log("[copy-static] static assets and standalone dependencies ready");
