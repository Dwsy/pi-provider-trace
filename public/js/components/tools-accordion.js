import { el } from "../core/dom.js";
import { escapeHtml } from "../lib/format.js";
import { t } from "../core/i18n.js";

function normalizeTool(tool) {
  if (!tool || typeof tool !== "object") return { name: "?", type: "unknown", description: "", schema: null, raw: tool };
  const fn = tool.function;
  const name = tool.name || fn?.name || tool.tool_name || "?";
  const type = tool.type || (fn ? "function" : "tool");
  const description = tool.description || fn?.description || "";
  const schema = tool.input_schema || fn?.parameters || tool.parameters || null;
  return { name, type, description, schema, raw: tool };
}

function schemaBlock(schema) {
  if (!schema) return el("p", { className: "req-tool-empty" }, [t("reqToolNoSchema")]);
  const pre = el("pre", { className: "json req-tool-schema" });
  try {
    pre.textContent = typeof schema === "string" ? schema : JSON.stringify(schema, null, 2);
  } catch {
    pre.textContent = String(schema);
  }
  return pre;
}

function toolSummary(schema) {
  if (!schema || typeof schema !== "object") return "";
  const props = schema.properties && typeof schema.properties === "object" ? Object.keys(schema.properties) : [];
  if (props.length) return props.slice(0, 6).join(", ") + (props.length > 6 ? "…" : "");
  if (Array.isArray(schema.required) && schema.required.length) return "required: " + schema.required.join(", ");
  return schema.type ? String(schema.type) : "";
}

export function bindToolsAccordion(root) {
  root.querySelectorAll(".req-acc-item").forEach((item) => {
    const btn = item.querySelector(".req-acc-trigger");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const open = item.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });
}

export function ToolsAccordion(tools) {
  const wrap = el("div", { className: "req-tools-accordion" });
  if (!tools?.length) {
    wrap.append(el("p", { className: "empty" }, [t("reqToolNone")]));
    return wrap;
  }

  tools.forEach((tool, i) => {
    const n = normalizeTool(tool);
    const summary = toolSummary(n.schema);
    const item = el("div", { className: "req-acc-item" + (i === 0 ? " open" : "") });

    const trigger = el("button", { type: "button", className: "req-acc-trigger" });
    trigger.setAttribute("aria-expanded", i === 0 ? "true" : "false");
    const chevron = el("span", { className: "req-acc-chevron" }, ["▸"]);
    const title = el("span", { className: "req-acc-title" }, [escapeHtml(n.name)]);
    const badge = el("span", { className: "req-acc-badge" }, [escapeHtml(n.type)]);
    trigger.append(chevron, title, badge);
    if (summary) {
      trigger.append(el("span", { className: "req-acc-hint" }, [escapeHtml(summary)]));
    }

    const panel = el("div", { className: "req-acc-panel" });
    if (n.description) {
      panel.append(el("p", { className: "req-tool-desc" }, [n.description]));
    }
    panel.append(el("div", { className: "req-acc-label" }, [t("reqToolSchema")]));
    panel.append(schemaBlock(n.schema));

    const extraKeys = Object.keys(n.raw || {}).filter(
      (k) => !["name", "type", "description", "input_schema", "function", "parameters"].includes(k),
    );
    if (extraKeys.length) {
      const extra = {};
      for (const k of extraKeys) extra[k] = n.raw[k];
      panel.append(el("div", { className: "req-acc-label" }, [t("reqSectionRaw")]));
      const pre = el("pre", { className: "json" });
      pre.textContent = JSON.stringify(extra, null, 2);
      panel.append(pre);
    }

    item.append(trigger, panel);
    wrap.append(item);
  });

  bindToolsAccordion(wrap);
  return wrap;
}