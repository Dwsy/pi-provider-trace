import { state } from "../core/state.js";
import { loadI18n, applyI18nStatic, applyThemeSelectLabels, t } from "../core/i18n.js";
import { getThemePreference, setThemePreference, watchSystemTheme } from "../core/theme.js";
import { fetchHistory, fetchStatus } from "../data/api.js";
import { exchanges, timelineEntries, clearStore } from "../data/store.js";
import { ingest, ingestTimeline } from "../data/ingest.js";
import { bindTabBar } from "../components/tab-bar.js";
import { renderSessionList } from "../views/session-list.js";
import { renderExchangeList } from "../views/exchange-list.js";
import { renderPanel } from "../views/exchange-panel.js";
import { loadSessionMetrics } from "../views/overview.js";
import { connectStream, onIncomingRecord } from "./stream.js";

function updateStats() {
  let sse = 0;
  for (const ex of exchanges.values()) sse += ex.sse.length;
  const pi = timelineEntries.filter((r) => r.kind === "pi_event").length;
  const el = document.getElementById("stats");
  if (el) el.textContent = t("stats", { exchanges: exchanges.size, sse, pi });
}

function refreshUi() {
  updateStats();
  const listEl = document.getElementById("exchangeList");
  const panelEl = document.getElementById("panel");
  renderExchangeList(listEl, refreshUi);
  renderPanel(panelEl, refreshUi);
}

async function loadSessionHistory(key) {
  const recs = await fetchHistory(key);
  clearStore();
  for (const rec of recs) {
    ingest(rec);
    ingestTimeline(rec);
  }
  updateStats();
  await loadSessionMetrics(key);
  refreshUi();
}

export async function selectSession(key, reloadList = true) {
  if (reloadList) renderSessionList(document.getElementById("sessionList"), selectSession, refreshUi);
  state.selectedSessionKey = key;
  state.selectedExchangeId = null;
  await loadSessionHistory(key);
  connectStream(key, (rec) => onIncomingRecord(rec, refreshUi));
  if (reloadList) renderSessionList(document.getElementById("sessionList"), selectSession, refreshUi);
}

async function refreshStatus() {
  try {
    const j = await fetchStatus();
    const el = document.getElementById("traceState");
    if (el) {
      el.textContent = j.traceEnabled ? t("traceOn") : t("traceOff");
      el.className = "pill " + (j.traceEnabled ? "on" : "");
    }
    if (j.activeSession?.key && !state.selectedSessionKey) await selectSession(j.activeSession.key);
  } catch {}
}

export async function bootstrap() {
  await loadI18n();
  applyI18nStatic();
  const themeSel = document.getElementById("theme");
  if (themeSel) {
    themeSel.innerHTML = "<option value=\"system\"></option><option value=\"light\"></option><option value=\"dark\"></option>";
    themeSel.value = getThemePreference();
    applyThemeSelectLabels();
    themeSel.onchange = (e) => {
      setThemePreference(e.target.value);
    };
  }
  document.getElementById("lang").onchange = (e) => {
    state.locale = e.target.value;
    localStorage.setItem("pi-trace-locale", state.locale);
    applyI18nStatic();
    applyThemeSelectLabels();
    refreshUi();
    renderSessionList(document.getElementById("sessionList"), selectSession, refreshUi);
  };
  bindTabBar(document.querySelector(".tabs"), () => renderPanel(document.getElementById("panel"), refreshUi));
  document.getElementById("search").oninput = (e) => {
    state.searchQ = e.target.value.trim();
    renderExchangeList(document.getElementById("exchangeList"), refreshUi);
  };
  document.getElementById("autoSelect").onchange = (e) => { state.autoSelect = e.target.checked; };
  document.getElementById("btnClear").onclick = () => {
    clearStore();
    state.selectedExchangeId = null;
    updateStats();
    renderExchangeList(document.getElementById("exchangeList"), refreshUi);
    if (state.activeTab === "timeline") renderPanel(document.getElementById("panel"), refreshUi);
    else document.getElementById("panel").innerHTML = '<div class="empty">' + t("emptyCleared") + "</div>";
  };
  document.getElementById("btnPause").onclick = (e) => {
    state.paused = !state.paused;
    e.target.textContent = state.paused ? t("resume") : t("pause");
  };
  renderSessionList(document.getElementById("sessionList"), selectSession, refreshUi);
  setInterval(() => renderSessionList(document.getElementById("sessionList"), selectSession, refreshUi), 4000);
  setInterval(refreshStatus, 2500);
  watchSystemTheme(() => {});
  await refreshStatus();
  renderPanel(document.getElementById("panel"), refreshUi);
}
