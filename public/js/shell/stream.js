import { state } from "../core/state.js";
import { t } from "../core/i18n.js";
import { ingest, ingestTimeline } from "../data/ingest.js";
import { loadSessionMetrics } from "../views/overview.js";

export function connectStream(sessionKey, onRecord) {
  if (state.es) {
    state.es.close();
    state.es = null;
  }
  const q = sessionKey ? "?session=" + encodeURIComponent(sessionKey) : "";
  state.es = new EventSource("/api/stream" + q);
  const conn = document.getElementById("conn");
  state.es.onopen = () => {
    if (conn) { conn.textContent = t("live"); conn.className = "pill on"; }
  };
  state.es.onerror = () => {
    if (conn) { conn.textContent = t("offline"); conn.className = "pill"; }
  };
  state.es.onmessage = (ev) => {
    if (state.paused) return;
    try {
      onRecord(JSON.parse(ev.data));
    } catch {}
  };
}

export function onIncomingRecord(rec, refresh) {
  ingest(rec);
  ingestTimeline(rec);
  if (state.autoSelect && rec.kind === "request") state.selectedExchangeId = rec.id;
  refresh(rec);
  if (rec.kind === "llm_usage" && state.selectedSessionKey) {
    loadSessionMetrics(state.selectedSessionKey).then(refresh);
  }
}
