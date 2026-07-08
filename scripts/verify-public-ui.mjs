import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const required = [
  "index.html",
  "css/tokens.css", "css/base.css", "css/components.css", "css/forms.css", "css/layout.css", "css/code-highlight.css", "css/chrome.css",
  "js/main.js", "js/shell/app.js", "js/core/state.js", "js/core/theme.js",
  "js/views/exchange-panel.js",
];

let ok = true;
for (const rel of required) {
  const p = join(publicDir, rel);
  if (!existsSync(p)) { console.error("MISSING", rel); ok = false; }
}
const html = readFileSync(join(publicDir, "index.html"), "utf8");
const compCss = readFileSync(join(publicDir, "css/components.css"), "utf8");
const tokens = readFileSync(join(publicDir, "css/tokens.css"), "utf8");
if (!tokens.includes("--canvas") || !tokens.includes('[data-theme="light"]')) {
  console.error("tokens: --canvas and light theme required");
  ok = false;
}
if (compCss.includes("linear-gradient(180deg, #0c1a2e")) {
  console.error("Factory: remove stream-hero gradient");
  ok = false;
}
if (!compCss.includes(".panel-bone")) {
  console.error("Factory: .panel-bone missing in components.css");
  ok = false;
}
const designDoc = join(publicDir, "..", "docs", "design", "factory-style-reference.md");
if (!existsSync(designDoc)) {
  console.error("missing docs/design/factory-style-reference.md");
  ok = false;
}
if (!tokens.includes('[data-theme="light"]')) {
  console.error("tokens.css must define light theme");
  ok = false;
}
if (!html.includes('id="theme"')) {
  console.error("index.html must have theme select");
  ok = false;
}
if (!html.includes("pi-trace-theme")) {
  console.error("index.html must have theme boot script");
  ok = false;
}
if (!html.includes('type="module"') || !html.includes("/js/main.js")) {
  console.error("index.html must use module main.js");
  ok = false;
}
if (existsSync(join(publicDir, "app.js"))) {
  console.error("legacy app.js should not exist");
  ok = false;
}
function walkJs(dir, base = "") {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + "/" + name.name : name.name;
    if (name.isDirectory()) walkJs(join(dir, name.name), rel);
    else if (name.name.endsWith(".js")) {
      const src = readFileSync(join(dir, name.name), "utf8");
      if (src.includes("from ") && src.match(/from\s+["'](\.\.\/[^"']+)["']/g)) {
        for (const m of src.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
          const imp = m[1];
          const resolved = join(publicDir, "js", rel.replace(/[^/]+$/, ""), imp).replace(/\/js\/js\//, "/js/");
          // skip deep check - just count files
        }
      }
    }
  }
}
walkJs(join(publicDir, "js"));
const jsCount = [];
function count(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) count(join(dir, e.name));
    else if (e.name.endsWith(".js")) jsCount.push(e.name);
  }
}
count(join(publicDir, "js"));
if (jsCount.length < 18) { console.error("expected >=18 js modules, got", jsCount.length); ok = false; }
if (!ok) process.exit(1);
console.log("verify-public-ui: ok (" + jsCount.length + " js modules)");
