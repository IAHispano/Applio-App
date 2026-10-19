// i18n-sync: align every locale with en_US.json (the key authority).
// For each language file (except en_US.json):
//   - delete keys missing from en_US AND unseen in code AND untranslated
//     (a translated value is evidence of intent — e.g. backend errors
//     via t(errMsg()) — and is kept, reported as KEPT-TRANSLATED),
//   - add keys missing from the language (English value = visible fallback),
//   - re-sort A-Z, keep the file's EOL style,
//   - report UNTRANSLATED entries (value == English) as file:line.
//
// Usage (repo root):
//   node scripts/i18n/sync.mjs                     # dry run: report only
//   node scripts/i18n/sync.mjs --apply             # write changes
//   node scripts/i18n/sync.mjs --apply --lang es   # only es_ES.json (substring match)
// Safety: aborts when the extractor reports unresolved REVIEW sites or when
// en_US itself lacks extracted keys (update en_US first).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LANG_DIR = path.join(root, "assets", "i18n", "languages");
const EN_FILE = path.join(LANG_DIR, "en_US.json");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const langIdx = args.indexOf("--lang");
const langFilter = langIdx >= 0 ? args[langIdx + 1] || null : null;

// 1. Extracted key inventory (single source of truth, shared with i18n-extract).
let extractedOut;
try {
  extractedOut = execFileSync(process.execPath, [path.join(root, "scripts", "i18n", "extract.mjs")], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  console.error("extractor failed, aborting sync");
  process.exit(2);
}
const extracted = new Set();
for (const line of extractedOut.split("\n")) {
  const t = line.trim();
  if (t.startsWith('"')) {
    try {
      extracted.add(JSON.parse(t));
    } catch {
      /* not a key line */
    }
  }
}

// 2. en_US is the authority: it must contain everything extracted.
const enRaw = fs.readFileSync(EN_FILE, "utf8");
const en = JSON.parse(enRaw);
const enMissing = [...extracted].filter((k) => !(k in en));
if (enMissing.length > 0) {
  console.error(`en_US.json lacks ${enMissing.length} extracted keys — update it first:`);
  for (const k of enMissing.slice(0, 20)) console.error(`  MISSING-EN ${k}`);
  process.exit(2);
}
const enKeys = new Set(Object.keys(en));

let totalUntranslated = 0;
for (const name of fs.readdirSync(LANG_DIR).sort()) {
  if (name === "en_US.json" || !name.endsWith(".json")) continue;
  if (langFilter && !name.toLowerCase().includes(langFilter.toLowerCase())) continue;
  const file = path.join(LANG_DIR, name);
  const raw = fs.readFileSync(file, "utf8");
  const nl = raw.includes("\r\n") ? "\r\n" : "\n";
  const dict = JSON.parse(raw);

  const extraAll = Object.keys(dict).filter((k) => !enKeys.has(k) && !extracted.has(k));
  // Never delete a human translation: a value that differs from the key is
  // evidence someone needed it (e.g. backend errors via t(errMsg())).
  // Only truly dead weight (untranslated + unreferenced) goes.
  const extra = extraAll.filter((k) => dict[k] === k);
  const keptTranslated = extraAll.filter((k) => dict[k] !== k);
  const missing = [...enKeys].filter((k) => !(k in dict));

  if (APPLY) {
    for (const k of extra) delete dict[k];
    for (const k of missing) dict[k] = en[k];
    const ordered = Object.fromEntries(Object.keys(dict).sort().map((k) => [k, dict[k]]));
    fs.writeFileSync(file, `${JSON.stringify(ordered, null, 2).replaceAll("\n", nl)}${nl}`);
    JSON.parse(fs.readFileSync(file, "utf8")); // validate
    console.error(`${name}: -${extra.length} extra, +${missing.length} from English, sorted`);
  } else {
    for (const k of extra) console.log(`EXTRA ${name} :: ${k}`);
    for (const k of keptTranslated) console.log(`KEPT-TRANSLATED ${name} :: ${k}`);
    for (const k of missing) console.log(`MISSING ${name} :: ${k}`);
  }

  // 3. Untranslated report with real line numbers (post-sort layout when applying).
  const check = APPLY ? JSON.parse(fs.readFileSync(file, "utf8")) : dict;
  const checkEn = en;
  const lines = APPLY
    ? fs.readFileSync(file, "utf8").split(nl)
    : raw.split(nl);
  const lineOf = new Map();
  lines.forEach((ln, i) => {
    const m = ln.match(/^\s*"((?:[^"\\]|\\.)*)"\s*:/);
    if (m) {
      try {
        lineOf.set(JSON.parse(`"${m[1]}"`), i + 1);
      } catch {
        /* ignore */
      }
    }
  });
  let n = 0;
  for (const k of Object.keys(check)) {
    if (check[k] === checkEn[k]) {
      console.log(`UNTRANSLATED ${name}:${lineOf.get(k) ?? "?"} :: ${k}`);
      n++;
    }
  }
  totalUntranslated += n;
  console.error(`${name}: ${n} untranslated`);
}
console.error(`---\n${APPLY ? "applied" : "dry run"} · ${totalUntranslated} untranslated total`);
