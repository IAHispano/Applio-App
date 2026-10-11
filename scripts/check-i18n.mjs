import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "assets/i18n/languages");
const baselineFile = path.join(directory, "en_US.json");
const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
const literals = new Set();
const required = new Set();
function strings(node, target) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    if (node.text.trim()) target.add(node.text);
  } else ts.forEachChild(node, (child) => strings(child, target));
}
function scan(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (["node_modules", ".next", ".next-dev", "dist"].includes(entry.name)) continue;
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (/\.(ts|tsx)$/.test(file)) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node) => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.add(node.text);
        if (
          file.startsWith(path.join(root, "frontend/web")) &&
          ts.isPropertyAssignment(node) &&
          ["label", "title", "blurb", "subtitle", "desc"].includes(node.name.getText(source)) &&
          (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
        )
          strings(node.initializer, required);
        if (
          ts.isVariableDeclaration(node) &&
          ["historyStateLabels", "names"].includes(node.name.getText(source)) &&
          node.initializer
        )
          strings(node.initializer, required);
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "t" &&
          node.arguments[0]
        )
          strings(node.arguments[0], required);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
}
scan(path.join(root, "frontend/web"));
scan(path.join(root, "frontend/desktop/src"));
scan(path.join(root, "backend/api/src"));
// Dynamic labels in navigation, status maps and option tables are source literals.
for (const key of Object.keys(baseline)) if (key.trim() && literals.has(key)) required.add(key);
const keys = [...required].sort();
const unused = Object.keys(baseline).filter((key) => !required.has(key));
const sync = process.argv.includes("--sync");
const prune = process.argv.includes("--prune");
let errors = 0;
for (const name of fs.readdirSync(directory).filter((name) => name.endsWith(".json"))) {
  const file = path.join(directory, name);
  const dictionary = JSON.parse(fs.readFileSync(file, "utf8"));
  if (name === "en_US.json" && sync) for (const key of keys) dictionary[key] ??= key;
  if (prune) for (const key of Object.keys(dictionary)) if (!required.has(key)) delete dictionary[key];
  const missing = keys.filter((key) => typeof dictionary[key] !== "string" || !dictionary[key].trim());
  if (missing.length) {
    errors += missing.length;
    console.log(`${name}: ${missing.length} missing translations`);
    if (process.argv.includes("--details")) console.log(JSON.stringify(missing, null, 2));
  }
  const tokens = (text) =>
    [...text.matchAll(/\$?\{\w+\}|%[sd]/g)]
      .map((match) => match[0])
      .sort()
      .join("|");
  for (const key of keys) {
    if (typeof dictionary[key] === "string" && tokens(key) !== tokens(dictionary[key])) {
      errors++;
      console.log(`${name}: mismatched placeholders in ${JSON.stringify(key)}`);
    }
  }
  if (sync || prune) {
    const sorted = Object.fromEntries(
      Object.keys(dictionary)
        .sort()
        .map((key) => [key, dictionary[key]]),
    );
    fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
  }
}
console.log(`${keys.length} desktop keys; ${unused.length} obsolete keys${prune ? " removed" : ""}.`);
if (process.argv.includes("--check") && errors) process.exitCode = 1;
