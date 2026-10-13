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
const SKIP_DIRS = new Set(["node_modules", ".next", "dist"]);

// Stable carrier files whose string values reach t() dynamically.
// Each entry documents WHY its strings are translation keys.
const POOL_FILES = [
  {
    file: "lib/setting-help.ts",
    reason: "t(SETTING_HELP.*) and t(PITCH_METHOD_HELP.*)",
    pick: (source, text) => collectObjectStringValues(source, text),
  },
  {
    file: "components/layout/nav.ts",
    reason: "t(item.label), t(item.badge), t(section.title); blurbs via description",
    pick: (source, text) => collectProps(source, text, ["label", "blurb", "badge", "title"]),
  },
  {
    file: "lib/job-history.ts",
    reason: "t(historyStateLabels.*), t(fieldLabel()) values, fieldValue Yes/No",
    pick: (source, text) => collectObjectStringValues(source, text),
  },
  {
    file: "components/setup/FirstRunSetup.tsx",
    reason: "t(step.title), t(step.desc): static step list",
    pick: (source, text) => collectProps(source, text, ["title", "desc"]),
  },
  {
    file: "app/settings/page.tsx",
    reason: "t(opt.name), t(opt.subtitle): static theme presets; t(o.label): font preset names",
    pick: (source, text) => collectProps(source, text, ["name", "subtitle", "label"]),
  },
];

// t() arguments that are runtime passthrough by design: the backend/model
// returns English text and t() falls back to it unchanged. Never dict keys.
const PASSTHROUGH = /(errMsg\(|job\.label|job\.type|ev\.title|ev\.phase|ver\.status|fieldLabel\(|fieldValue\()/;

function collectFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
  }
  return out;
}

function isTCall(node, source) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  // t("...")
  if (ts.isIdentifier(callee) && (callee.text === "t" || callee.text === "trayT")) return true;
  // tRef.current("...") — the only member-call form used (AudioWavePlayerImpl)
  if (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "current" &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "tRef"
  )
    return true;
  return false;
}

function usesI18n(source) {
  // The t in scope must come from the i18n hook, the desktop tray
  // translator, or a TrayTranslate parameter; otherwise a local `t`
  // (test helper, date-fns import, ...) would be a false positive.
  return (
    /from\s+["']@\/lib\/i18n["']/.test(source) ||
    /const trayT/.test(source) ||
    /TrayTranslate/.test(source)
  );
}

function literalOf(arg) {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  return undefined;
}

// Literals inside `cond ? "a" : "b"`, `x || "fallback"`, `x ?? "fallback"`.
// Both sides are real keys; collecting them cannot misfire.
function branchLiterals(arg, out = []) {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) out.push(arg.text);
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

const POOL_PREFIX = /^(SETTING_HELP\.|PITCH_METHOD_HELP\[|historyStateLabels\[)/;

function collectObjectStringValues(sourceFile, text) {
  const found = new Map();
  function visit(node) {
    if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      found.set(node.initializer.text, line);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function collectProps(sourceFile, text, names) {
  const found = new Map();
  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      names.includes(node.name.text) &&
      (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
    ) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      found.set(node.initializer.text, line);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

const keys = new Map(); // key -> Set<file:line>
const review = []; // dynamic sites needing a human

// ["a","b"].map((s) => ... t(s) ...) — every element is a real key.
// Same for Object.entries(CONST_OBJ).map(([k, v]) => ... t(v) ...)
// with a module-level object literal (e.g. ISSUES map in DatasetReview).
function collectMappedLiterals(source, file, rel) {
  const found = [];
  function tUsesParam(fn, param) {
    let hit = false;
    function visit(n) {
      if (
        ts.isCallExpression(n) &&
        ((ts.isIdentifier(n.expression) && (n.expression.text === "t" || n.expression.text === "trayT")) ||
          (ts.isPropertyAccessExpression(n.expression) &&
            n.expression.name.text === "current")) &&
        n.arguments.length > 0 &&
        ts.isIdentifier(n.arguments[0]) &&
        n.arguments[0].text === param
      )
        hit = true;
      ts.forEachChild(n, visit);
    }
    visit(fn);
    return hit;
  }
  // Peel `as const`, satisfies and parens: [["k","v"] as const].map(...)
function unwrap(node) {
  while (
    ts.isAsExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression;
  return node;
}

function moduleArray(source, name) {
  let found = null;
  function visit(n) {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === name &&
      n.initializer &&
      ts.isArrayLiteralExpression(unwrap(n.initializer))
    )
      found = unwrap(n.initializer);
    ts.forEachChild(n, visit);
  }
  visit(source);
  return found;
}

function moduleObject(name) {    let obj = null;
    function visit(n) {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === name &&
        n.initializer &&
        ts.isObjectLiteralExpression(n.initializer)
      )
        obj = n.initializer;
      ts.forEachChild(n, visit);
    }
    visit(source);
    return obj;
  }
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "map" &&
      node.arguments.length > 0 &&
      (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]))
    ) {
      const fn = node.arguments[0];
      let recv = unwrap(node.expression.expression);
      // [["k","v"]] stored in a local const (JobDetails sections):
      // resolve it like moduleObject.
      if (ts.isIdentifier(recv)) {
        const decl = moduleArray(source, recv.text);
        if (decl) recv = decl;
      }
      // Case A: ["a","b"].map((s) => ... t(s) ...), or
      // [["k","Label"]].map(([k, v]) => ... t(v) ...) (JobDetails sections,
      // DatasetReview section labels). Every collected literal is a real key.
      if (ts.isArrayLiteralExpression(recv) && fn.parameters.length > 0) {
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const first = fn.parameters[0];
        if (ts.isIdentifier(first.name) && tUsesParam(fn.body, first.name.text)) {
          if (recv.elements.every((e) => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e))) {
            for (const e of recv.elements) found.push([e.text, `${rel}:${line} [mapped array]`]);
          }
        } else if (ts.isArrayBindingPattern(first.name)) {
          const idx = first.name.elements.findIndex(
            (el) =>
              ts.isBindingElement(el) &&
              ts.isIdentifier(el.name) &&
              tUsesParam(fn.body, el.name.text),
          );
          if (idx >= 0) {
            for (const e of recv.elements) {
              if (
                ts.isArrayLiteralExpression(e) &&
                e.elements.length > idx &&
                (ts.isStringLiteral(e.elements[idx]) || ts.isNoSubstitutionTemplateLiteral(e.elements[idx]))
              )
                found.push([e.elements[idx].text, `${rel}:${line} [mapped pairs]`]);
            }
          }
        }
      }
      // Case B: Object.entries(OBJ).map(([k, v]) => ... t(v) ...)
      if (
        ts.isCallExpression(recv) &&
        ts.isPropertyAccessExpression(recv.expression) &&
        recv.expression.name.text === "entries" &&
        recv.arguments.length > 0 &&
        ts.isIdentifier(recv.arguments[0])
      ) {
        const obj = moduleObject(recv.arguments[0].text);
        const [first] = fn.parameters;
        if (obj && first && ts.isArrayBindingPattern(first.name) && first.name.elements.length === 2) {
          const vParam = first.name.elements[1];
          if (vParam && ts.isBindingElement(vParam) && ts.isIdentifier(vParam.name) && tUsesParam(fn.body, vParam.name.text)) {
            const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            for (const prop of obj.properties) {
              if (
                ts.isPropertyAssignment(prop) &&
                (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer))
              )
                found.push([prop.initializer.text, `${rel}:${line} [mapped entries]`]);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

function add(key, loc) {
  if (!key) return;
  if (!keys.has(key)) keys.set(key, new Set());
  keys.get(key).add(loc);
}

for (const file of SCAN_DIRS.flatMap((d) => collectFiles(d))) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const i18nFile = usesI18n(text);
  function visit(node) {
    if (isTCall(node, source)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (!i18nFile) {
        review.push(`${rel}:${line} t() without @/lib/i18n import — verify callee`);
      } else if (node.arguments.length === 0) {
        review.push(`${rel}:${line} t() with no arguments`);
      } else {
        const lit = literalOf(node.arguments[0]);
        if (lit !== undefined) add(lit, `${rel}:${line}`);
        else {
          const branches = branchLiterals(node.arguments[0]);
          const expr = node.arguments[0].getText(source).slice(0, 80);
          if (branches.length > 0) {
            for (const b of branches) add(b, `${rel}:${line} [branch of: ${expr}]`);
          } else if (!POOL_PREFIX.test(expr) && !PASSTHROUGH.test(expr)) {
            review.push(`${rel}:${line} dynamic key: ${expr}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

for (const pool of POOL_FILES) {
  const file = path.join(WEB, pool.file);
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const [key, line] of pool.pick(source, text)) add(key, `${rel}:${line} [pool: ${pool.reason}]`);
}

for (const file of SCAN_DIRS.flatMap((d) => collectFiles(d))) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const [key, loc] of collectMappedLiterals(source, file, rel)) add(key, loc);
}

// Dynamic sites already covered by extraction rules above. Each entry is
// SELF-VERIFYING: it only suppresses the review note when every listed key
// was actually collected. If a key goes missing, the site reappears in REVIEW.
const COVERED = [
  { file: "app/jobs/page.tsx", expr: "label", reason: "fieldLabel() pool", verify: ["Voice model"] },
  { file: "app/settings/page.tsx", expr: "opt.name", reason: "themes pool", verify: ["Default"] },
  { file: "app/settings/page.tsx", expr: "opt.subtitle", reason: "themes pool", verify: ["Dark Slate"] },
  { file: "app/settings/page.tsx", expr: "o.label", reason: "font presets pool + runtime font proper nouns fall back", verify: ["Theme default"] },
  { file: "app/train/page.tsx", expr: "s", reason: "mapped arrays", verify: ["pre", "Skip", "Automatic"] },
  { file: "components/JobDetails.tsx", expr: "title", reason: "mapped pairs", verify: ["Settings", "Results"] },
  { file: "components/train/DatasetReview.tsx", expr: "label", reason: "mapped entries + mapped pairs", verify: ["Duplicate", "Clipped sections"] },
  { file: "components/RealtimeCalibration.tsx", expr: "label", reason: "mapped array", verify: ["Playback gaps", "Result"] },
  { file: "components/layout/MobileNav.tsx", expr: "tab.label", reason: "nav pool", verify: ["Models"] },
  { file: "components/layout/Sidebar.tsx", expr: "section.title", reason: "nav pool", verify: ["Voice"] },
  { file: "components/layout/Sidebar.tsx", expr: "item.label", reason: "nav pool", verify: ["Inference"] },
  { file: "components/layout/Sidebar.tsx", expr: "item.badge", reason: "nav pool", verify: ["Models"] },
  { file: "components/setup/FirstRunSetup.tsx", expr: "step.title", reason: "steps pool", verify: ["Audio Processing Engine"] },
  { file: "components/setup/FirstRunSetup.tsx", expr: "step.desc", reason: "steps pool", verify: ["Faiss indexer, FCPE, Crepe, and acoustic models"] },
  { file: "components/train/DatasetReview.tsx", expr: "label", reason: "mapped pairs", verify: ["Clipped sections", "Silent sections"] },
  { file: "components/train/DatasetReview.tsx", expr: "ISSUES[issue]", reason: "mapped entries", verify: ["Duplicate", "No usable signal"] },
  { file: "desktop/src/main.ts", expr: "key", reason: "mapped arrays with trayT", verify: ["Retry", "Quit", "Restart and Update"] },
  { file: "desktop/src/main.ts", expr: "trayStatus(state)", reason: "trayStatus static literals", verify: ["Realtime active", "Engine ready"] },
  { file: "desktop/src/tray-menu.ts", expr: "trayStatus(state)", reason: "trayStatus static literals", verify: ["Realtime active", "Engine ready"] },
];

const args = process.argv.slice(2);
const checkFile = args[args.indexOf("--check") + 1] || null;
const doFix = args.includes("--fix");
const doPrune = args.includes("--prune");
const doSort = args.includes("--sort");

const sortedKeys = [...keys.keys()].sort();
const coveredOK = [];
const keptReview = [];
for (const r of review) {
  const m = r.match(/^(.+?):\d+ dynamic key: (.*)$/);
  const hit = m && COVERED.find((c) => m[1].endsWith(c.file) && m[2] === c.expr);
  if (hit && hit.verify.every((k) => keys.has(k))) coveredOK.push(`${m[1]}:${hit.expr} (${hit.reason})`);
  else keptReview.push(r);
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
    const { execFileSync } = await import("node:child_process");
    const candidates = Object.keys(dict).filter((k) => !keys.has(k));
    const removable = [];
    for (const k of candidates) {
      let hits = "";
      try {
        hits = execFileSync(
          "grep",
          ["-rlF", "--include=*.tsx", "--include=*.ts", "--exclude-dir=node_modules", "--exclude-dir=.next", k, ...SCAN_DIRS],
          { encoding: "utf8" },
        ).trim();
      } catch {
        hits = ""; // grep exits 1 when nothing matches
      }
      if (hits) console.error(`KEEP (mentioned in source): ${k} <- ${hits.split("\n")[0]}`);
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
      // Ensure the entry before closing brace has no trailing comma only if
      // the original file had none there.
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
    const ordered = Object.fromEntries(Object.keys(data).sort().map((k) => [k, data[k]]));
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
