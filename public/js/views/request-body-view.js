import { el } from "../core/dom.js";
import { escapeHtml } from "../lib/format.js";
import { t } from "../core/i18n.js";
import { bindSubTabs, createSubTabBar, createSubPanel } from "../components/sub-tab-bar.js";
import { ToolsAccordion } from "../components/tools-accordion.js";

function contentPreview(content) {
  if (content == null) return "—";
  if (typeof content === "string") {
    const s = content.trim();
    return s.length > 500 ? s.slice(0, 500) + "…" : s;
  }
  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (block?.type === "text" && block.text) parts.push(block.text);
      else if (block?.type === "image") parts.push("[image]");
      else if (block?.type === "tool_use") parts.push("[tool_use " + (block.name || "?") + "]");
      else if (block?.type === "tool_result") parts.push("[tool_result]");
      else parts.push("[" + (block?.type || "block") + "]");
    }
    const joined = parts.join(" ");
    return joined.length > 500 ? joined.slice(0, 500) + "…" : joined || JSON.stringify(content).slice(0, 200);
  }
  if (typeof content === "object") return JSON.stringify(content).slice(0, 400);
  return String(content);
}

function kvGrid(pairs) {
  const grid = el("div", { className: "headers-grid req-kv" });
  for (const [k, v] of pairs) {
    if (v == null || v === "") continue;
    const row = el("div");
    row.innerHTML = "<span>" + escapeHtml(k) + "</span><span>" + escapeHtml(String(v)) + "</span>";
    grid.append(row);
  }
  return grid;
}

function messagesTable(messages) {
  const table = el("table", { className: "usage-table usage-grid req-msg-table" });
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>role</th><th>content</th></tr>";
  table.append(thead);
  const tbody = document.createElement("tbody");
  for (const msg of messages) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" + escapeHtml(msg.role || "?") + "</td><td>" + escapeHtml(contentPreview(msg.content)) + "</td>";
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

function panelWrap(inner) {
  const card = el("div", { className: "panel-dark req-section-inner" });
  card.append(inner);
  return card;
}

export function renderRequestBodyUi(bodyPreview) {
  const root = el("div", { className: "req-body-ui" });
  if (!bodyPreview) {
    root.append(el("p", { className: "empty" }, [t("noBody")]));
    return root;
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyPreview);
  } catch {
    const tabs = [{ id: "plain", label: t("reqTabPlain"), active: true }];
    root.append(createSubTabBar(tabs));
    root.append(createSubPanel("plain", panelWrap(el("pre", { className: "json" }, [bodyPreview])), true));
    bindSubTabs(root);
    return root;
  }

  const sections = [];
  const topKeys = ["model", "stream", "max_tokens", "temperature", "top_p", "provider", "metadata"];
  const pairs = topKeys.map((k) => [k, parsed[k] != null ? (typeof parsed[k] === "object" ? JSON.stringify(parsed[k]) : parsed[k]) : null]);
  if (parsed.system != null) {
    pairs.push(["system", typeof parsed.system === "string" ? contentPreview(parsed.system) : JSON.stringify(parsed.system).slice(0, 200)]);
  }
  const meta = kvGrid(pairs);
  if (meta.childElementCount) {
    sections.push({ id: "params", label: t("reqSectionParams"), el: meta });
  }

  const messages = parsed.messages || parsed.input?.messages;
  if (Array.isArray(messages) && messages.length) {
    sections.push({
      id: "messages",
      label: t("reqSectionMessages") + " (" + messages.length + ")",
      el: messagesTable(messages),
    });
  }

  const tools = parsed.tools || parsed.input?.tools;
  if (Array.isArray(tools) && tools.length) {
    sections.push({
      id: "tools",
      label: t("reqSectionTools") + " (" + tools.length + ")",
      el: ToolsAccordion(tools),
    });
  }

  const input = parsed.input;
  if (input && typeof input === "object" && !messages) {
    sections.push({
      id: "input",
      label: t("reqTabInput"),
      el: el("pre", { className: "json" }, [JSON.stringify(input, null, 2)]),
    });
  }

  const known = new Set([...topKeys, "messages", "tools", "system", "input"]);
  const extra = Object.keys(parsed).filter((k) => !known.has(k));
  if (extra.length) {
    const extraObj = {};
    for (const k of extra) extraObj[k] = parsed[k];
    sections.push({
      id: "other",
      label: t("reqSectionRaw"),
      el: el("pre", { className: "json" }, [JSON.stringify(extraObj, null, 2)]),
    });
  }

  if (!sections.length) {
    sections.push({
      id: "json",
      label: t("reqTabJson"),
      el: el("pre", { className: "json" }, [JSON.stringify(parsed, null, 2)]),
    });
  }

  const tabDefs = sections.map((s, i) => ({ id: s.id, label: s.label, active: i === 0 }));
  root.append(createSubTabBar(tabDefs));
  sections.forEach((s, i) => {
    root.append(createSubPanel(s.id, panelWrap(s.el), i === 0));
  });
  bindSubTabs(root);
  return root;
}