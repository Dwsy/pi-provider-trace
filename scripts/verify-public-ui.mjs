import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const required = [
  "index.html",
  "css/app.css",
  "js/main.js",
  "js/api.js",
  "js/model.js",
  "js/view.js",
  "js/overview.js",
  "js/fixture.js",
  "js/format.js",
  "js/i18n.js",
];

const errors = [];
for (const file of required) {
  if (!existsSync(join(publicDir, file))) errors.push(`missing ${file}`);
}

const html = readFileSync(join(publicDir, "index.html"), "utf8");
const css = readFileSync(join(publicDir, "css/app.css"), "utf8");
const jsFiles = readdirSync(join(publicDir, "js"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => entry.name)
  .sort();

if (jsFiles.length !== 8) errors.push(`expected 8 runtime JS modules, got ${jsFiles.length}`);
if (/(?:src|href)=["']https?:\/\//.test(html)) errors.push("index.html must not load remote assets");
if (!html.includes('type="module"') || !html.includes('/js/main.js')) errors.push("module entrypoint missing");
if (!html.includes("pi-trace-theme") || !html.includes("pi-trace-locale")) errors.push("early theme/locale boot missing");
if (!html.includes('id="globalSearch"')) errors.push("global search missing");
if (!html.includes('data-tab="flow"')) errors.push("linked flow inspector missing");
if (!html.includes('data-tab="headers"')) errors.push("request headers inspector missing");
if (!html.includes('data-tab="responseMeta"')) errors.push("response metadata inspector missing");
if (!html.includes('id="overviewSurface"')) errors.push("overview surface missing");
if (!html.includes('id="overviewButton"')) errors.push("overview entry point missing from the topbar");
if (!html.includes('data-window="24h"') || !html.includes('data-window="all"')) errors.push("overview window selector incomplete");
if (!html.includes('id="shortcutsDialog"')) errors.push("keyboard shortcut help missing");
if (!html.includes('id="liveStatus"')) errors.push("polite live region missing");
if (/id="(sessionList|requestList)"[^>]*aria-live/.test(html)) errors.push("list panes must not be live regions");
if (!css.includes('[data-theme="dark"]')) errors.push("dark theme missing");
if (!css.includes("@media (max-width: 960px)")) errors.push("mobile single-pane layout missing");
if (!css.includes("prefers-reduced-motion")) errors.push("reduced motion handling missing");
if (!css.includes("min-height: 100dvh")) errors.push("stable dynamic viewport height missing");
if (css.includes("#000000") || css.includes("#000;")) errors.push("pure black is not part of the palette");

const i18nSource = readFileSync(join(publicDir, "js/i18n.js"), "utf8");
const localeKeys = i18nSource.split(/\n\s{2}(?:zh|en):\s*\{/).slice(1)
  .map((block) => new Set([...block.matchAll(/^\s{4}([A-Za-z0-9_]+):/gm)].map((match) => match[1])));
if (localeKeys.length !== 2) errors.push("i18n locales are not parseable");
else {
  for (const key of localeKeys[0]) if (!localeKeys[1].has(key)) errors.push(`i18n key missing from en: ${key}`);
  for (const key of localeKeys[1]) if (!localeKeys[0].has(key)) errors.push(`i18n key missing from zh: ${key}`);
}

for (const file of jsFiles) {
  const source = readFileSync(join(publicDir, "js", file), "utf8");
  if (source.includes("sse_line")) errors.push(`${file} still depends on raw SSE rows`);
  // Sample data may only enter through the api boundary, behind the ?fixture=1 gate.
  if (file !== "api.js" && source.includes('from "./fixture.js"')) errors.push(`${file} imports the fixture directly`);
  if (file === "api.js" && !source.includes('get("fixture") === "1"')) errors.push("fixture is not gated on ?fixture=1");
  if (file === "view.js" && source.includes("messages.slice(-8)")) errors.push("Pi context is still limited to recent messages");
  if (file === "view.js" && source.includes("is-truncated")) errors.push("Pi context still uses hidden truncation");
  for (const match of source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
    const target = join(publicDir, "js", match[1]);
    if (!existsSync(target)) errors.push(`${file} imports missing ${match[1]}`);
  }
}

const oldDirs = ["components", "core", "data", "lib", "shell", "views"];
for (const directory of oldDirs) {
  if (existsSync(join(publicDir, "js", directory))) {
    const remaining = readdirSync(join(publicDir, "js", directory));
    if (remaining.length) errors.push(`legacy frontend directory still contains files: ${directory}`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(`verify-public-ui: ok (${jsFiles.join(", ")})`);
