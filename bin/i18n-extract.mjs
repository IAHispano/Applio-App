// i18n-extract: precise translation-key inventory for Applio.
// Extracts every key the code can pass to t()/trayT() using the TypeScript
// AST (no regex guessing), plus documented carrier pools and self-verifying
// coverage rules. Dynamic sites it cannot prove land in REVIEW, never in keys.
//
// Usage (repo root):
//   node bin/i18n-extract.mjs                                   # print keys + REVIEW
//   node bin/i18n-extract.mjs --check <dict.json>               # report MISSING, exit 1 if any
//   node bin/i18n-extract.mjs --check <dict> --fix              # append missing (identity), keep file order
//   node bin/i18n-extract.mjs --check <dict> --prune            # delete unused (refuses if REVIEW pending)
//   node bin/i18n-extract.mjs --check <dict> --sort              # sort keys A-Z, keep EOL style
// Combine --fix/--prune/--sort freely; --prune runs before --sort.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(root, "frontend", "web");
const SCAN_DIRS = ["app", "components", "lib"].map((d) => path.join(WEB, d));
SCAN_DIRS.push(path.join(root, "frontend", "desktop", "src"));
const BACKEND_SRC = path.join(root, "backend", "api", "src");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist"]);

function collectFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
  }
  return out;
}

function parse(file) {
  const text = fs.readFileSync(file, "utf8");
  return { text, source: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true) };
}

function isStr(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

// Peel `as const`, satisfies and parens.
function unwrap(node) {
  while (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node))
    node = node.expression;
  return node;
}

// Literals inside `cond ? "a" : "b"`, `x || "fallback"`, `x ?? "fallback"`.
function branchLiterals(arg, out = []) {
  if (isStr(arg)) out.push(arg.text);
  else if (ts.isConditionalExpression(arg)) {
    branchLiterals(arg.whenTrue, out);
    branchLiterals(arg.whenFalse, out);
  } else if (
    ts.isBinaryExpression(arg) &&
    (arg.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      arg.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    branchLiterals(arg.left, out);
    branchLiterals(arg.right, out);
  }
  return out;
}

function isTCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee) && (callee.text === "t" || callee.text === "trayT")) return true;
  if (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "current" &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "tRef"
  )
    return true;
  return false;
}

function usesI18n(text) {
  return /from\s+["']@\/lib\/i18n["']/.test(text) || /const trayT/.test(text) || /TrayTranslate/.test(text);
}

// Module-level `const NAME = {...}` / `= [...]` in a file.
function moduleDecl(source, name) {
  let found = null;
  function visit(n) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer)
      found = unwrap(n.initializer);
    ts.forEachChild(n, visit);
  }
  visit(source);
  return found;
}

function objectValues(obj) {
  const out = [];
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && isStr(prop.initializer)) out.push(prop.initializer.text);
  }
  return out;
}

// Static carrier files whose values reach t() dynamically.
const POOL_FILES = [
  { file: "lib/setting-help.ts", reason: "t(SETTING_HELP.*), t(PITCH_METHOD_HELP.*)", pick: "object-values" },
  {
    file: "components/layout/nav.ts",
    reason: "t(item.label/badge), t(section.title)",
    pick: ["label", "blurb", "badge", "title"],
  },
  {
    file: "lib/job-history.ts",
    reason: "t(historyStateLabels.*), t(fieldLabel()), Yes/No",
    pick: "object-values",
  },
  { file: "components/setup/FirstRunSetup.tsx", reason: "t(step.title/desc)", pick: ["title", "desc"] },
  {
    file: "app/settings/page.tsx",
    reason: "t(opt.name/subtitle), t(o.label)",
    pick: ["name", "subtitle", "label"],
  },
];

function poolKeys(file) {
  const { source } = parse(path.join(WEB, file.rel));
  const found = new Map();
  const loc = (n) => source.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  if (file.pick === "object-values") {
    (function visit(n) {
      if (ts.isPropertyAssignment(n) && isStr(n.initializer)) found.set(n.initializer.text, loc(n));
      ts.forEachChild(n, visit);
    })(source);
  } else {
    (function visit(n) {
      if (
        ts.isPropertyAssignment(n) &&
        ts.isIdentifier(n.name) &&
        file.pick.includes(n.name.text) &&
        isStr(n.initializer)
      )
        found.set(n.initializer.text, loc(n));
      ts.forEachChild(n, visit);
    })(source);
  }
  return found;
}

// Display setters: setJobStage(job, "…"), setCalibrationActivity("…"),
// setSplashStatus("…"). String args (or their literal branches) are UI text.
const DISPLAY_SETTERS = new Set(["setJobStage", "setCalibrationActivity", "setSplashStatus"]);

function resolveDisplayArg(source, file, arg, found, rel) {
  // MAP[key] on a module-level const.
  if (ts.isElementAccessExpression(arg) && ts.isIdentifier(arg.expression)) {
    const obj = moduleDecl(source, arg.expression.text);
    if (obj && ts.isObjectLiteralExpression(obj)) {
      const line = source.getLineAndCharacterOfPosition(arg.getStart()).line + 1;
      for (const v of objectValues(obj)) found.push([v, `${rel}:${line} [display values]`]);
      return true;
    }
  }
  // fn(x): literals in that function's return statements (same repo).
  if (ts.isCallExpression(arg) && ts.isIdentifier(arg.expression)) {
    const name = arg.expression.text;
    const roots = [source];
    if (fs.existsSync(BACKEND_SRC)) {
      for (const f of collectFiles(BACKEND_SRC)) {
        if (f === file) continue;
        roots.push(parse(f).source);
      }
    }
    let hit = false;
    for (const r of roots) {
      (function walk(n) {
        if (
          (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) &&
          n.name &&
          ts.isIdentifier(n.name) &&
          n.name.text === name
        ) {
          (function ret(m) {
            if (ts.isReturnStatement(m) && m.expression) {
              for (const lit of branchLiterals(m.expression)) {
                if (typeof lit === "string") {
                  const line = source.getLineAndCharacterOfPosition(arg.getStart()).line + 1;
                  found.push([lit, `${rel}:${line} [display returns]`]);
                  hit = true;
                }
              }
            }
            ts.forEachChild(m, ret);
          })(n.body);
        } else {
          ts.forEachChild(n, walk);
        }
      })(r);
      if (hit) break;
    }
    return hit;
  }
  return false;
}

const keys = new Map();
const review = [];

function add(key, loc) {
  if (!key) return;
  if (!keys.has(key)) keys.set(key, new Set());
  keys.get(key).add(loc);
}

function tUsesParam(fn, param) {
  let hit = false;
  (function visit(n) {
    if (
      ts.isCallExpression(n) &&
      ((ts.isIdentifier(n.expression) && (n.expression.text === "t" || n.expression.text === "trayT")) ||
        (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "current")) &&
      n.arguments.length > 0 &&
      ts.isIdentifier(n.arguments[0]) &&
      n.arguments[0].text === param
    )
      hit = true;
    ts.forEachChild(n, visit);
  })(fn);
  return hit;
}

function collectMapped(source, rel, found) {
  (function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "map" &&
      node.arguments.length > 0 &&
      (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]))
    ) {
      const fn = node.arguments[0];
      let recv = unwrap(node.expression.expression);
      if (ts.isIdentifier(recv)) {
        const decl = moduleDecl(source, recv.text);
        if (decl && ts.isArrayLiteralExpression(decl)) recv = decl;
      }
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const first = fn.parameters[0];
      if (first && ts.isIdentifier(first.name) && tUsesParam(fn.body, first.name.text)) {
        if (ts.isArrayLiteralExpression(recv) && recv.elements.every(isStr)) {
          for (const e of recv.elements) found.push([e.text, `${rel}:${line} [mapped array]`]);
        }
      } else if (first && ts.isArrayBindingPattern(first.name)) {
        const idx = first.name.elements.findIndex(
          (el) => ts.isBindingElement(el) && ts.isIdentifier(el.name) && tUsesParam(fn.body, el.name.text),
        );
        if (idx >= 0 && ts.isArrayLiteralExpression(recv)) {
          for (const e of recv.elements) {
            const u = unwrap(e);
            if (ts.isArrayLiteralExpression(u) && u.elements.length > idx && isStr(u.elements[idx]))
              found.push([u.elements[idx].text, `${rel}:${line} [mapped pairs]`]);
          }
        }
      }
      // Object.entries(OBJ).map(([k, v]) => ... t(v) ...)
      const recvU = unwrap(node.expression.expression);
      if (
        ts.isCallExpression(recvU) &&
        ts.isPropertyAccessExpression(recvU.expression) &&
        recvU.expression.name.text === "entries" &&
        recvU.arguments.length > 0 &&
        ts.isIdentifier(recvU.arguments[0])
      ) {
        const obj = moduleDecl(source, recvU.arguments[0].text);
        if (obj && ts.isObjectLiteralExpression(obj) && first && ts.isArrayBindingPattern(first.name)) {
          const vEl = first.name.elements[1];
          if (
            vEl &&
            ts.isBindingElement(vEl) &&
            ts.isIdentifier(vEl.name) &&
            tUsesParam(fn.body, vEl.name.text)
          ) {
            for (const v of objectValues(obj)) found.push([v, `${rel}:${line} [mapped entries]`]);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  })(source);
}

function collectDisplayed(source, file, rel, found) {
  (function visit(node) {
    // Backend user-facing errors: setError(job, "…") and thrown route
    // errors surface via errMsg() → t() on the frontend.
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "setError"
    ) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      for (const arg of node.arguments.slice(1)) {
        for (const lit of branchLiterals(arg)) {
          if (typeof lit === "string") found.push([lit, `${rel}:${line} [backend error]`]);
        }
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Error") {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      for (const arg of node.arguments) {
        for (const lit of branchLiterals(arg)) {
          if (typeof lit === "string") found.push([lit, `${rel}:${line} [thrown error]`]);
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      DISPLAY_SETTERS.has(node.expression.text)
    ) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      let hit = false;
      for (const arg of node.arguments) {
        let argHit = false;
        for (const lit of branchLiterals(arg)) {
          if (typeof lit === "string") {
            found.push([lit, `${rel}:${line} [display setter]`]);
            argHit = true;
          }
        }
        if (!argHit) {
          const before = found.length;
          resolveDisplayArg(source, file, arg, found, rel);
          if (found.length > before) argHit = true;
        }
        hit = hit || argHit;
      }
      if (!hit) found.push([null, `${rel}:${line} REVIEW display setter with non-literal arg`]);
    }
    // const x = cond ? "a" : "b" flowing into t(x) in the same function.
    if (
      (ts.isVariableDeclaration(node) || ts.isBindingElement(node)) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      branchLiterals(node.initializer).length > 0
    ) {
      const name = node.name.text;
      let fn = node.parent;
      while (fn && !ts.isFunctionLike(fn) && !ts.isSourceFile(fn)) fn = fn.parent;
      if (fn) {
        let flows = false;
        (function checker(n) {
          if (
            ts.isCallExpression(n) &&
            ts.isIdentifier(n.expression) &&
            n.expression.text === "t" &&
            n.arguments.length > 0 &&
            ts.isIdentifier(n.arguments[0]) &&
            n.arguments[0].text === name
          )
            flows = true;
          ts.forEachChild(n, checker);
        })(fn);
        if (flows) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          for (const lit of branchLiterals(node.initializer)) {
            if (typeof lit === "string") found.push([lit, `${rel}:${line} [flows to t()]`]);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  })(source);
}

const POOL_PREFIX = /^(SETTING_HELP\.|PITCH_METHOD_HELP\[|historyStateLabels\[)/;
const PASSTHROUGH =
  /(errMsg\(|job\.label|job\.type|ev\.title|ev\.phase|ver\.status|fieldLabel\(|fieldValue\()/;

for (const file of SCAN_DIRS.flatMap((d) => collectFiles(d))) {
  const { text, source } = parse(file);
  const rel = path.relative(root, file).replaceAll("\\", "/");
  const i18nFile = usesI18n(text);
  (function visit(node) {
    if (isTCall(node)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (!i18nFile) {
        review.push(`${rel}:${line} t() without @/lib/i18n import — verify callee`);
      } else if (node.arguments.length === 0) {
        review.push(`${rel}:${line} t() with no arguments`);
      } else {
        const a0 = node.arguments[0];
        if (isStr(a0)) add(a0.text, `${rel}:${line}`);
        else {
          const branches = branchLiterals(a0).filter((s) => typeof s === "string");
          const expr = a0.getText(source).slice(0, 80);
          if (branches.length > 0) {
            for (const b of branches) add(b, `${rel}:${line} [branch of: ${expr}]`);
          } else if (!POOL_PREFIX.test(expr) && !PASSTHROUGH.test(expr)) {
            review.push(`${rel}:${line} dynamic key: ${expr}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  })(source);
  const mapped = [];
  collectMapped(source, rel, mapped);
  for (const [k, loc] of mapped) add(k, loc);
  const disp = [];
  collectDisplayed(source, file, rel, disp);
  for (const [k, loc] of disp) {
    if (k === null) review.push(loc);
    else add(k, loc);
  }
}

function pickPool(pool, source) {
  const found = new Map();
  const loc = (n) => source.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  (function visit(n) {
    if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || isStr(n.name))) {
      const hit =
        pool.pick === "object-values" || (Array.isArray(pool.pick) && pool.pick.includes(n.name.text));
      if (hit && isStr(n.initializer)) found.set(n.initializer.text, loc(n));
    }
    ts.forEachChild(n, visit);
  })(source);
  return found;
}

for (const pool of POOL_FILES) {
  const file = pool.file.startsWith("/") ? path.join(root, pool.file) : path.join(WEB, pool.file);
  const { source } = parse(file);
  const rel = path.relative(root, file).replaceAll("\\", "/");
  for (const [key, line] of pickPool(pool, source)) add(key, `${rel}:${line} [pool]`);
}

if (fs.existsSync(BACKEND_SRC)) {
  for (const file of collectFiles(BACKEND_SRC)) {
    const { source } = parse(file);
    const rel = path.relative(root, file).replaceAll("\\", "/");
    const disp = [];
    collectDisplayed(source, file, rel, disp);
    for (const [k, loc] of disp) {
      if (k === null) review.push(loc);
      else add(k, loc);
    }
  }
}

// Rust menu and job labels are explicit carriers outside the TypeScript AST.
for (const relative of ["frontend/desktop/tray-labels.json", "backend/rust-api/i18n-labels.json"]) {
  for (const key of JSON.parse(fs.readFileSync(path.join(root, relative), "utf8")))
    add(key, `${relative} [Rust labels]`);
}

// Dynamic sites already covered by extraction rules above. Each entry is
// SELF-VERIFYING: it only suppresses the review note when every listed key
// was actually collected. If a key goes missing, the site reappears in REVIEW.
const COVERED = [
  { file: "app/jobs/page.tsx", expr: "label", reason: "fieldLabel() pool", verify: ["Voice model"] },
  { file: "app/settings/page.tsx", expr: "opt.name", reason: "themes pool", verify: ["Default"] },
  { file: "app/settings/page.tsx", expr: "opt.subtitle", reason: "themes pool", verify: ["Dark Slate"] },
  {
    file: "app/settings/page.tsx",
    expr: "o.label",
    reason: "font presets pool + runtime font proper nouns fall back",
    verify: ["Theme default"],
  },
  { file: "app/train/page.tsx", expr: "s", reason: "mapped arrays", verify: ["pre", "Skip", "Automatic"] },
  {
    file: "app/train/page.tsx",
    expr: "status",
    reason: "flows-to-t() const",
    verify: ["Skipped", "Pending"],
  },
  {
    file: "components/JobDetails.tsx",
    expr: "title",
    reason: "mapped pairs",
    verify: ["Settings", "Results"],
  },
  {
    file: "components/JobStatus.tsx",
    expr: "job.stage",
    reason: "display setter values",
    verify: ["Converting audio…"],
  },
  {
    file: "components/RealtimeCalibration.tsx",
    expr: "label",
    reason: "mapped array",
    verify: ["Playback gaps", "Result"],
  },
  {
    file: "components/RealtimeCalibration.tsx",
    expr: "activity",
    reason: "calibration setter values",
    verify: ["Warming up…"],
  },
  { file: "components/layout/MobileNav.tsx", expr: "tab.label", reason: "nav pool", verify: ["Models"] },
  { file: "components/layout/Sidebar.tsx", expr: "section.title", reason: "nav pool", verify: ["Voice"] },
  {
    file: "components/layout/Sidebar.tsx",
    expr: "item.label",
    reason: "nav pool",
    verify: ["Convert Audio"],
  },
  { file: "components/layout/Sidebar.tsx", expr: "item.badge", reason: "nav pool", verify: ["Models"] },
  {
    file: "components/setup/FirstRunSetup.tsx",
    expr: "step.title",
    reason: "steps pool",
    verify: ["Audio Processing Engine"],
  },
  {
    file: "components/setup/FirstRunSetup.tsx",
    expr: "step.desc",
    reason: "steps pool",
    verify: ["Faiss indexer, FCPE, Crepe, and acoustic models"],
  },
  {
    file: "components/train/DatasetReview.tsx",
    expr: "label",
    reason: "mapped entries + mapped pairs",
    verify: ["Duplicate", "Clipped sections"],
  },
  {
    file: "components/train/DatasetReview.tsx",
    expr: "ISSUES[issue]",
    reason: "mapped entries",
    verify: ["Duplicate", "No usable signal"],
  },
  {
    file: "components/train/TrainingConsole.tsx",
    expr: "ev.phase",
    reason: "console parser phases are backend log text, English fallback by design",
    verify: [],
  },
];

const args = process.argv.slice(2);
const checkIdx = args.indexOf("--check");
const checkFile = checkIdx >= 0 ? args[checkIdx + 1] || null : null;
const doFix = args.includes("--fix");
const doPrune = args.includes("--prune");
const doSort = args.includes("--sort");

const sortedKeys = [...keys.keys()].sort();
const keptReview = [];
for (const r of review) {
  const m = r.match(/^(.+?):\d+ dynamic key: (.*)$/);
  const hit = m && COVERED.find((c) => m[1].endsWith(c.file) && m[2] === c.expr);
  if (hit && hit.verify.every((k) => keys.has(k))) continue; // covered
  keptReview.push(r);
}
review.length = 0;
review.push(...keptReview);
if (checkFile) {
  const dictPath = path.resolve(root, checkFile);
  const dict = JSON.parse(fs.readFileSync(dictPath, "utf8"));
  const missing = sortedKeys.filter((k) => !(k in dict));
  for (const k of missing) console.log(`MISSING ${k}`);
  console.error(`${sortedKeys.length} keys extracted, ${missing.length} missing from ${checkFile}`);
  if (doFix && missing.length > 0) {
    // Append-only: the repo keeps insertion order (newest last). Never
    // rewrite or re-sort the file, so the diff stays minimal.
    let text = fs.readFileSync(dictPath, "utf8");
    if (!text.endsWith("\n")) text += "\n";
    const lines = text.split("\n");
    const closeIdx = lines.findLastIndex((l) => l.trim() === "}");
    if (closeIdx < 1) {
      console.error(`cannot locate closing brace in ${checkFile}, aborting --fix`);
      process.exit(2);
    }
    if (!lines[closeIdx - 1].trimEnd().endsWith(",") && !lines[closeIdx - 1].trim().endsWith("{")) {
      lines[closeIdx - 1] = `${lines[closeIdx - 1]},`;
    }
    const indent = (lines[closeIdx - 1].match(/^\s*/) || [""])[0] || "  ";
    const entries = missing.map((k) => `${indent}${JSON.stringify(k)}: ${JSON.stringify(k)},`);
    // Drop the trailing comma on the last inserted entry (file has none).
    entries[entries.length - 1] = entries[entries.length - 1].replace(/,$/, "");
    lines.splice(closeIdx, 0, ...entries);
    fs.writeFileSync(dictPath, `${lines.join("\n").replace(/\n+$/, "\n")}`);
    JSON.parse(fs.readFileSync(dictPath, "utf8")); // validate
    console.error(`appended ${missing.length} identity entries to ${checkFile}`);
  }
  if (doPrune) {
    // Triple guard: (1) only the file passed to --check (use it for en_US
    // only); (2) refuse when REVIEW has unresolved dynamic sites, since an
    // unverified t(x) could need one of these keys; (3) keep any key whose
    // exact "literal" still appears anywhere in source — a key no file
    // mentions cannot be referenced, not even dynamically.
    if (review.length > 0) {
      console.error(`--prune refused: ${review.length} unresolved REVIEW sites. Resolve them first.`);
      for (const r of review) console.error(`  ${r}`);
      process.exit(2);
    }
    const candidates = Object.keys(dict).filter((k) => !keys.has(k));
    const removable = [];
    // A conservative source-presence check must work on Windows too. Include
    // native Rust sources so pruning never removes a native error/stage label.
    const rustDir = path.join(root, "backend/rust-api/src");
    const sources = [...SCAN_DIRS.flatMap((dir) => collectFiles(dir))];
    if (fs.existsSync(rustDir))
      for (const name of fs.readdirSync(rustDir)) {
        if (name.endsWith(".rs")) sources.push(path.join(rustDir, name));
      }
    const texts = sources.map((file) => [file, fs.readFileSync(file, "utf8")]);
    for (const k of candidates) {
      const hit = texts.find(([, text]) => text.includes(k));
      if (hit) console.error(`KEEP (mentioned in source): ${k} <- ${hit[0]}`);
      else removable.push(k);
    }
    for (const k of removable) {
      delete dict[k];
      console.log(`PRUNED ${k}`);
    }
    if (removable.length > 0) {
      // Rewrite preserving original order and formatting: drop pruned lines,
      // fix a dangling comma left on the new last entry.
      const text = fs.readFileSync(dictPath, "utf8");
      const remaining = new Set(Object.keys(dict));
      const kept = text.split("\n").filter((line) => {
        const m = line.match(/^\s*"((?:[^"\\]|\\.)*)"\s*:/);
        return !m || remaining.has(JSON.parse(`"${m[1]}"`));
      });
      for (let i = kept.length - 1; i >= 0; i--) {
        if (kept[i].trim() === "{" || kept[i].trim() === "}") continue;
        if (kept[i].includes(":")) {
          kept[i] = kept[i].replace(/,\s*$/, "");
          break;
        }
      }
      fs.writeFileSync(dictPath, `${kept.join("\n").replace(/\n+$/, "\n")}`);
      JSON.parse(fs.readFileSync(dictPath, "utf8")); // validate
      console.error(`pruned ${removable.length} unused keys from ${checkFile}`);
    } else {
      console.error(`nothing to prune in ${checkFile}`);
    }
  }
  if (doSort) {
    const raw = fs.readFileSync(dictPath, "utf8");
    const nl = raw.includes("\r\n") ? "\r\n" : "\n";
    const data = JSON.parse(raw);
    const ordered = Object.fromEntries(
      Object.keys(data)
        .sort()
        .map((k) => [k, data[k]]),
    );
    fs.writeFileSync(dictPath, `${JSON.stringify(ordered, null, 2).replaceAll("\n", nl)}${nl}`);
    JSON.parse(fs.readFileSync(dictPath, "utf8")); // validate
    console.error(`sorted ${checkFile} (${Object.keys(ordered).length} keys)`);
  }
  process.exit(missing.length > 0 ? 1 : 0);
}

for (const k of sortedKeys) console.log(JSON.stringify(k));
console.error(`---\n${sortedKeys.length} keys from ${SCAN_DIRS.length} dirs`);
if (review.length > 0) {
  console.error(`REVIEW (${review.length} dynamic sites, not guessed):`);
  for (const r of review) console.error(`  ${r}`);
}
