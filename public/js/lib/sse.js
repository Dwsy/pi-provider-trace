export function parseSseLine(line) {
  const t0 = (line || "").trim();
  if (!t0) return { kind: "empty" };
  if (t0.startsWith("event:")) return { kind: "event", name: t0.slice(6).trim() };
  if (t0.startsWith("data:")) {
    const payload = t0.slice(5).trim();
    if (payload === "[DONE]") return { kind: "done" };
    try { return { kind: "json", value: JSON.parse(payload) }; } catch { return { kind: "text", value: payload }; }
  }
  return { kind: "raw", value: t0 };
}

export function extractDeltaText(obj) {
  if (!obj || typeof obj !== "object") return "";
  if (typeof obj.delta === "string") return obj.delta;
  if (obj.delta?.text) return obj.delta.text;
  if (obj.type === "content_block_delta" && obj.delta?.text) return obj.delta.text;
  const ch = obj.choices?.[0];
  if (ch?.delta?.content) return ch.delta.content;
  if (ch?.delta?.text) return ch.delta.text;
  if (typeof obj.text === "string") return obj.text;
  if (obj.type === "response.output_text.delta" && obj.delta) return obj.delta;
  return "";
}

export function sseEventLabel(parsed) {
  if (parsed.kind === "event") return parsed.name;
  if (parsed.kind === "done") return "[DONE]";
  if (parsed.kind === "json") {
    const v = parsed.value;
    return v.type || (v.choices ? "chunk" : "data");
  }
  return "line";
}

export function assembleStreamText(sseRecords) {
  let text = "";
  for (const rec of sseRecords) {
    const parsed = parseSseLine(rec.line);
    if (parsed.kind === "json") {
      const d = extractDeltaText(parsed.value);
      if (d) text += d;
    }
  }
  return text;
}
