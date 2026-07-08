import { parseSseLine, extractDeltaText } from "./sse.js";

export function assembleSseRecords(sseRecords) {
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

export function buildTimelineList(entries, opts) {
  const { filterVisible, mergeSseDelta, showSse } = opts;
  const sorted = [...entries].sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));

  if (!mergeSseDelta) {
    return sorted.filter(filterVisible);
  }

  const out = [];
  let sseRun = [];
  let sseRunId = null;

  const flushSse = () => {
    if (!sseRun.length || !showSse) {
      sseRun = [];
      sseRunId = null;
      return;
    }
    const text = assembleSseRecords(sseRun);
    out.push({
      kind: "sse_merged",
      id: sseRunId || sseRun[0]?.id,
      ts: sseRun[0]?.ts,
      lineCount: sseRun.length,
      text,
      summary: text ? text.slice(0, 160) + (text.length > 160 ? "…" : "") : `(${sseRun.length} lines, no delta)`,
    });
    sseRun = [];
    sseRunId = null;
  };

  for (const rec of sorted) {
    if (rec.kind === "sse_line") {
      if (!showSse) continue;
      if (sseRun.length && rec.id !== sseRunId) flushSse();
      sseRunId = rec.id;
      sseRun.push(rec);
      continue;
    }
    flushSse();
    if (filterVisible(rec)) out.push(rec);
  }
  flushSse();
  return out;
}