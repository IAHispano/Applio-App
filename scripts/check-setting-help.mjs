import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const missing = [];
let checked = 0;
function scan(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (["node_modules", ".next", ".next-dev", "dist"].includes(entry.name)) continue;
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (file.endsWith(".tsx")) {
      // Reusable primitives accept help from callers; inspect their consumers.
      if (file.includes(`${path.sep}components${path.sep}ui${path.sep}`)) continue;
      const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node) {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const name = node.tagName.getText(source);
          if (["SliderField", "ToggleField", "CustomSelect", "Disclosure"].includes(name)) {
            checked++;
            const description = node.attributes.properties.find(a => ts.isJsxAttribute(a) && a.name.getText(source) === "description");
            if (!description?.initializer) {
              const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
              missing.push(`${path.relative(root, file)}:${line} ${name}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
scan(path.join(root, "frontend/web/app"));
scan(path.join(root, "frontend/web/components"));
assert.equal(missing.length, 0, `Settings need visible help:\n${missing.join("\n")}`);
console.log(`${checked} dropdown, slider and toggle consumers have setting descriptions.`);
