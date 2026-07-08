import { t } from "../core/i18n.js";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function highlightJson(src) {
  let out = "";
  let i = 0;
  const push = (text, cls) => {
    out += cls ? `<span class="${cls}">${escapeHtml(text)}</span>` : escapeHtml(text);
  };
  while (i < src.length) {
    const rest = src.slice(i);
    const ws = rest.match(/^\s+/);
    if (ws) {
      push(ws[0], null);
      i += ws[0].length;
      continue;
    }
    if (rest[0] === '"') {
      let j = 1;
      while (j < rest.length) {
        if (rest[j] === "\\") {
          j += 2;
          continue;
        }
        if (rest[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      const str = rest.slice(0, j);
      const after = rest.slice(j).match(/^\s*:/);
      push(str, after ? "tok-key" : "tok-str");
      i += j;
      continue;
    }
    const num = rest.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (num) {
      push(num[0], "tok-num");
      i += num[0].length;
      continue;
    }
    const lit = rest.match(/^(true|false|null)\b/);
    if (lit) {
      push(lit[0], "tok-lit");
      i += lit[0].length;
      continue;
    }
    push(rest[0], null);
    i += 1;
  }
  return out;
}

export function highlightMarkdown(src) {
  return src
    .split("\n")
    .map((line) => {
      const esc = escapeHtml(line);
      if (/^#{1,6}\s/.test(line)) return `<span class="tok-md-h">${esc}</span>`;
      if (/^```/.test(line)) return `<span class="tok-md-fence">${esc}</span>`;
      if (/^[-*+]\s/.test(line) || /^\d+\.\s/.test(line)) return `<span class="tok-md-li">${esc}</span>`;
      return esc.replace(/`([^`]+)`/g, "<span class=\"tok-md-code\">`$1`</span>");
    })
    .join("\n");
}

function langForPre(pre) {
  if (pre.classList.contains("markdown") || pre.dataset.lang === "markdown") return "markdown";
  if (pre.classList.contains("json") || pre.dataset.lang === "json") return "json";
  return null;
}

function wrapWithCopy(pre, raw) {
  if (pre.closest(".code-block-wrap")) return;
  const wrap = document.createElement("div");
  wrap.className = "code-block-wrap";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "code-copy-btn";
  btn.textContent = t("copyCode");
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(raw);
      btn.textContent = t("copiedCode");
      setTimeout(() => { btn.textContent = t("copyCode"); }, 1600);
    } catch {
      btn.textContent = t("copyFailed");
    }
  });
  pre.parentNode.insertBefore(wrap, pre);
  wrap.append(btn, pre);
}

function enhanceOnePre(pre) {
  if (pre.dataset.enhanced === "1") return;
  const lang = langForPre(pre);
  if (!lang) return;
  const raw = pre.textContent || "";
  if (!raw.trim()) return;
  pre.dataset.enhanced = "1";
  pre.innerHTML = lang === "markdown" ? highlightMarkdown(raw) : highlightJson(raw);
  pre.classList.add("code-highlighted", "lang-" + lang);
  wrapWithCopy(pre, raw);
}

export function enhanceCodeBlocks(root) {
  if (!root) return;
  root.querySelectorAll("pre.json, pre.markdown, pre[data-lang='json'], pre[data-lang='markdown']").forEach(enhanceOnePre);
}