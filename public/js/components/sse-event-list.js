import { el } from "../core/dom.js";
import { escapeHtml } from "../lib/format.js";
import { parseSseLine, extractDeltaText, sseEventLabel } from "../lib/sse.js";

function buildPayload(parsed, rawLine) {
  if (parsed.kind === "json") {
    const delta = extractDeltaText(parsed.value);
    if (delta) return { kind: "delta", text: delta };
    const compact = JSON.stringify(parsed.value);
    return { kind: "json", text: compact.length > 600 ? compact.slice(0, 600) + "…" : compact };
  }
  const line = (rawLine || "").trim();
  return { kind: "line", text: line.length > 400 ? line.slice(0, 400) + "…" : line || "—" };
}

export function SseEventList(sseRecords) {
  const list = el("div", { className: "sse-events" });
  if (!sseRecords?.length) return list;

  sseRecords.forEach((rec, i) => {
    const parsed = parseSseLine(rec.line);
    const label = sseEventLabel(parsed);
    const payload = buildPayload(parsed, rec.line);
    const row = el("article", {
      className: "sse-ev" + (payload.kind === "delta" ? " is-delta" : ""),
    });

    const meta = el("div", { className: "sse-ev-meta" });
    meta.append(el("span", { className: "sse-ev-idx" }, ["#" + (i + 1)]));
    meta.append(el("span", { className: "sse-ev-type" }, [label]));

    const body = el("div", { className: "sse-ev-body" });
    body.textContent = payload.text;

    row.append(meta, body);
    list.append(row);
  });

  return list;
}