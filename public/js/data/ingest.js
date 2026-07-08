import { state } from "../core/state.js";
import { ensureExchange, timelineEntries, seenTimelineKeys } from "./store.js";
import { mergeUsage } from "../lib/usage.js";

export function ingest(rec) {
  if (!rec || !rec.id) return;
  if (state.selectedSessionKey && rec.sessionKey && rec.sessionKey !== state.selectedSessionKey) return;
  if (rec.kind === "llm_usage" && rec.usage) {
    const ex = ensureExchange(rec.id);
    ex.usage = mergeUsage(ex.usage, rec.usage);
    ex.lastTs = rec.ts || ex.lastTs;
    return;
  }
  if (rec.kind !== "pi_event" && rec.kind !== "llm_usage") {
    const ex = ensureExchange(rec.id);
    if (rec.sessionKey) ex.sessionKey = rec.sessionKey;
    ex.lastTs = rec.ts || ex.lastTs;
    if (rec.kind === "request") ex.request = rec;
    else if (rec.kind === "response_meta") ex.response = rec;
    else if (rec.kind === "sse_line") ex.sse.push(rec);
    else if (rec.kind === "error") ex.errors.push(rec);
  }
}

function timelineDedupeKey(rec) {
  const base = `${rec.kind}|${rec.id ?? ""}|${rec.ts ?? ""}`;
  if (rec.kind === "pi_event") return `${base}|${rec.eventName ?? ""}|${rec.summary ?? ""}`;
  if (rec.kind === "sse_line") return `${base}|${(rec.line ?? "").slice(0, 120)}`;
  return base;
}

export function ingestTimeline(rec) {
  if (!rec || !rec.ts) return;
  if (state.selectedSessionKey && rec.sessionKey && rec.sessionKey !== state.selectedSessionKey) return;
  const key = timelineDedupeKey(rec);
  if (seenTimelineKeys.has(key)) return;
  seenTimelineKeys.add(key);
  timelineEntries.push(rec);
  if (timelineEntries.length > 2500) {
    timelineEntries.splice(0, timelineEntries.length - 2000);
    seenTimelineKeys.clear();
    for (const r of timelineEntries) seenTimelineKeys.add(timelineDedupeKey(r));
  }
}
