import {
  deleteSession as deleteSessionRequest,
  fetchHistory,
  fetchMetrics,
  fetchSessions,
  fetchStatus,
  historyBatchDownloadUrl,
  openTraceStream,
} from "./api.js";
import { applyStaticText, currentLocale, setLocale, t } from "./i18n.js";
import {
  ingestRecord,
  parseBody,
  rawEvidence,
  resetSessionTrace,
  selectTreeNode,
  selectedExchange,
  sortedExchanges,
  state,
  visibleSessions,
} from "./model.js";
import { prettyJson } from "./format.js";
import {
  patchLiveInspector,
  renderAll,
  renderConnection,
  renderInspector,
  renderRequests,
  renderSessionContext,
  renderSessions,
  renderStatic,
  showToast,
} from "./view.js";

const app = document.getElementById("app");
const search = document.getElementById("globalSearch");
const sessionList = document.getElementById("sessionList");
const requestList = document.getElementById("requestList");
const inspectorTabs = document.getElementById("inspectorTabs");
const providerFilter = document.getElementById("providerFilter");
const statusFilter = document.getElementById("statusFilter");
const followButton = document.getElementById("followButton");
const batchModeButton = document.getElementById("batchModeButton");
const selectAllSessions = document.getElementById("selectAllSessions");
const batchExportSessions = document.getElementById("batchExportSessions");
const batchDeleteSessions = document.getElementById("batchDeleteSessions");
const toggleSessionsButton = document.getElementById("toggleSessionsButton");
const toggleRequestsButton = document.getElementById("toggleRequestsButton");

let stopStream = null;
let sessionLoadController = null;
let fullRenderFrame = 0;
let livePatchFrame = 0;
let requestListTimer = 0;

function storedBoolean(key, fallback = false) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function applyDesktopLayout() {
  const sessionsCollapsed = storedBoolean("pi-trace-hide-sessions");
  const requestsCollapsed = storedBoolean("pi-trace-hide-requests");
  app.dataset.sessionsCollapsed = String(sessionsCollapsed);
  app.dataset.requestsCollapsed = String(requestsCollapsed);
  toggleSessionsButton.setAttribute("aria-pressed", String(!sessionsCollapsed));
  toggleRequestsButton.setAttribute("aria-pressed", String(!requestsCollapsed));
  try {
    const sessionWidth = Number(localStorage.getItem("pi-trace-sessions-width"));
    const requestWidth = Number(localStorage.getItem("pi-trace-requests-width"));
    if (Number.isFinite(sessionWidth) && sessionWidth >= 180) document.documentElement.style.setProperty("--sessions-width", `${sessionWidth}px`);
    if (Number.isFinite(requestWidth) && requestWidth >= 260) document.documentElement.style.setProperty("--requests-width", `${requestWidth}px`);
  } catch {}
}

function toggleDesktopPane(pane) {
  const key = pane === "sessions" ? "pi-trace-hide-sessions" : "pi-trace-hide-requests";
  const next = !storedBoolean(key);
  try { localStorage.setItem(key, String(next)); } catch {}
  applyDesktopLayout();
}

function bindPaneResizers() {
  const workbench = document.querySelector(".workbench");
  document.querySelectorAll("[data-resize-pane]").forEach((handle) => {
    const resizeBy = (delta) => {
      const pane = handle.dataset.resizePane;
      const target = document.querySelector(`.${pane}-pane`);
      const other = document.querySelector(`.${pane === "sessions" ? "requests" : "sessions"}-pane`);
      if (!target || !other) return;
      const minimum = pane === "sessions" ? 180 : 260;
      const maximum = Math.max(minimum, workbench.clientWidth - other.getBoundingClientRect().width - 370);
      const width = Math.round(Math.min(maximum, Math.max(minimum, target.getBoundingClientRect().width + delta)));
      document.documentElement.style.setProperty(`--${pane}-width`, `${width}px`);
      try { localStorage.setItem(`pi-trace-${pane}-width`, String(width)); } catch {}
    };

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const pane = handle.dataset.resizePane;
      const target = document.querySelector(`.${pane}-pane`);
      const other = document.querySelector(`.${pane === "sessions" ? "requests" : "sessions"}-pane`);
      const startWidth = target.getBoundingClientRect().width;
      const otherWidth = other.getBoundingClientRect().width;
      const minimum = pane === "sessions" ? 180 : 260;
      const maximum = Math.max(minimum, workbench.clientWidth - otherWidth - 370);
      handle.classList.add("is-resizing");
      document.body.classList.add("is-resizing-panes");
      handle.setPointerCapture(event.pointerId);

      const move = (moveEvent) => {
        const width = Math.round(Math.min(maximum, Math.max(minimum, startWidth + moveEvent.clientX - startX)));
        document.documentElement.style.setProperty(`--${pane}-width`, `${width}px`);
      };
      const finish = () => {
        handle.removeEventListener("pointermove", move);
        handle.classList.remove("is-resizing");
        document.body.classList.remove("is-resizing-panes");
        const width = Math.round(target.getBoundingClientRect().width);
        try { localStorage.setItem(`pi-trace-${pane}-width`, String(width)); } catch {}
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", finish, { once: true });
      handle.addEventListener("pointercancel", finish, { once: true });
    });

    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      resizeBy(event.key === "ArrowLeft" ? -16 : 16);
    });
  });
}

function toggleSessionSelection(key) {
  if (state.selectedSessionKeys.has(key)) state.selectedSessionKeys.delete(key);
  else state.selectedSessionKeys.add(key);
  renderSessions();
}

async function deleteSelectedSessions() {
  const keys = [...state.selectedSessionKeys];
  if (!keys.length || !window.confirm(t("confirmBatchDelete", { count: keys.length }))) return;
  let cursor = 0;
  let success = 0;
  let failed = 0;
  const deletedKeys = new Set();
  const workers = Array.from({ length: Math.min(4, keys.length) }, async () => {
    while (cursor < keys.length) {
      const key = keys[cursor++];
      try {
        await deleteSessionRequest(key);
        state.selectedSessionKeys.delete(key);
        deletedKeys.add(key);
        success += 1;
      } catch {
        failed += 1;
      }
    }
  });
  await Promise.all(workers);
  if (deletedKeys.has(state.selectedSessionKey)) {
    closeTraceStream();
    state.selectedSessionKey = null;
    resetSessionTrace();
  }
  showToast(failed
    ? t("batchDeletePartial", { success, failed })
    : t("batchDeleted", { count: success }));
  if (!failed) state.batchMode = false;
  await refreshSessions();
  setMobilePane("sessions");
}

function setMobilePane(pane) {
  app.dataset.mobilePane = pane;
}

function scheduleFullRender() {
  if (fullRenderFrame) return;
  fullRenderFrame = requestAnimationFrame(() => {
    fullRenderFrame = 0;
    renderAll();
  });
}

function scheduleLivePatch(exchange) {
  if (livePatchFrame) return;
  livePatchFrame = requestAnimationFrame(() => {
    livePatchFrame = 0;
    patchLiveInspector(exchange);
  });
}

function scheduleRequestListRender() {
  if (requestListTimer) return;
  requestListTimer = window.setTimeout(() => {
    requestListTimer = 0;
    renderRequests();
  }, 180);
}

function closeTraceStream() {
  stopStream?.();
  stopStream = null;
}

function connectTraceStream(sessionKey) {
  closeTraceStream();
  state.connection = "connecting";
  renderConnection();
  stopStream = openTraceStream(sessionKey, {
    open() {
      state.connection = "live";
      renderConnection();
    },
    error() {
      state.connection = "offline";
      renderConnection();
    },
    record(record) {
      const result = ingestRecord(record);
      if (!result.changed) return;
      if (state.follow && record.kind === "request") {
        state.selectedExchangeId = record.id;
        state.selectedNode = { kind: "generation", id: `gen-${record.id}` };
      }
      if (record.kind === "stream_update") {
        scheduleLivePatch(result.exchange);
        scheduleRequestListRender();
        return;
      }
      scheduleFullRender();
    },
  });
}

async function loadSession(sessionKey) {
  if (!sessionKey) return;
  sessionLoadController?.abort();
  sessionLoadController = new AbortController();
  const { signal } = sessionLoadController;

  resetSessionTrace();
  state.selectedSessionKey = sessionKey;
  state.loadingHistory = true;
  state.error = null;
  setMobilePane("requests");
  connectTraceStream(sessionKey);
  renderAll();

  try {
    const [history, metrics] = await Promise.all([
      fetchHistory(sessionKey, signal),
      fetchMetrics(sessionKey, signal),
    ]);
    const records = Array.isArray(history) ? history : history.records || [];
    const live = Array.isArray(history) ? [] : history.live || [];
    for (const record of records) ingestRecord(record);
    for (const record of live) ingestRecord(record);
    state.metrics = metrics;
    const newest = sortedExchanges()[0];
    if (!state.selectedExchangeId || !state.exchanges.has(state.selectedExchangeId)) {
      state.selectedExchangeId = newest?.id || null;
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (!signal.aborted) {
      state.loadingHistory = false;
      renderAll();
    }
  }
}

async function refreshSessions({ reloadCurrent = false } = {}) {
  state.loadingSessions = true;
  state.error = null;
  renderSessions();
  try {
    const [sessions, status] = await Promise.all([fetchSessions(), fetchStatus()]);
    state.sessions = sessions.sessions || [];
    state.activeSessionKey = sessions.activeSessionKey || status.activeSession?.key || null;
    const selectedStillExists = state.sessions.some((session) => session.key === state.selectedSessionKey);
    const next = selectedStillExists ? state.selectedSessionKey : state.activeSessionKey || state.sessions[0]?.key || null;
    state.selectedSessionKey = next;
    state.loadingSessions = false;
    renderAll();
    if (next && (reloadCurrent || !state.exchanges.size)) await loadSession(next);
  } catch (error) {
    state.loadingSessions = false;
    state.error = error instanceof Error ? error.message : String(error);
    renderAll();
  }
}

function selectExchange(exchangeId) {
  if (!state.exchanges.has(exchangeId)) return;
  state.selectedExchangeId = exchangeId;
  state.selectedNode = { kind: "generation", id: `gen-${exchangeId}` };
  state.follow = false;
  setMobilePane("inspector");
  renderStatic();
  renderRequests();
  renderInspector();
}

function selectNode(kind, id, exchangeId) {
  selectTreeNode({ kind, id, exchangeId });
  if (exchangeId && state.exchanges.has(exchangeId)) {
    state.selectedExchangeId = exchangeId;
  }
  state.follow = false;
  setMobilePane("inspector");
  renderStatic();
  renderRequests();
  renderInspector();
}

function toggleTreeCollapse(token) {
  const [scope, ...rest] = String(token || "").split(":");
  const id = rest.join(":");
  if (!id) return;
  const set = scope === "prompt" ? state.collapsedPrompts : state.collapsedTurns;
  if (set.has(id)) set.delete(id);
  else set.add(id);
  renderRequests();
}

async function copySelected(kind) {
  const exchange = selectedExchange();
  const values = {
    payload: exchange ? prettyJson(parseBody(exchange)) : "",
    raw: exchange ? prettyJson(rawEvidence(exchange)) : "",
    output: exchange?.stream?.text || "",
  };
  const text = values[kind] ?? "";
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  showToast(t("copied"));
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  try { localStorage.setItem("pi-trace-theme", next); } catch {}
}

function bindEvents() {
  sessionList.addEventListener("click", (event) => {
    const selection = event.target.closest("[data-session-select]");
    if (selection) {
      toggleSessionSelection(selection.dataset.sessionSelect);
      return;
    }
    const row = event.target.closest("[data-session-key]");
    if (row && state.batchMode) {
      toggleSessionSelection(row.dataset.sessionKey);
      return;
    }
    if (!row || row.dataset.sessionKey === state.selectedSessionKey) {
      if (row) setMobilePane("requests");
      return;
    }
    void loadSession(row.dataset.sessionKey);
  });

  requestList.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-tree-toggle]");
    if (toggle) {
      event.preventDefault();
      event.stopPropagation();
      toggleTreeCollapse(toggle.dataset.treeToggle);
      return;
    }
    const nodeRow = event.target.closest("[data-node-kind]");
    if (nodeRow) {
      selectNode(nodeRow.dataset.nodeKind, nodeRow.dataset.nodeId, nodeRow.dataset.exchangeId);
      return;
    }
    const row = event.target.closest("[data-exchange-id]");
    if (row) selectExchange(row.dataset.exchangeId);
  });

  requestList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const toggle = event.target.closest("[data-tree-toggle]");
    if (!toggle) return;
    event.preventDefault();
    event.stopPropagation();
    toggleTreeCollapse(toggle.dataset.treeToggle);
  });

  document.getElementById("listModeToggle")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-list-mode]");
    if (!button) return;
    state.listMode = button.dataset.listMode === "requests" ? "requests" : "turns";
    try { localStorage.setItem("pi-trace-list-mode", state.listMode); } catch {}
    renderSessionContext();
    renderRequests();
    renderInspector();
  });

  inspectorTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (!tab) return;
    state.activeTab = tab.dataset.tab;
    renderInspector();
  });

  document.addEventListener("click", (event) => {
    const mobileTarget = event.target.closest("[data-mobile-target]")?.dataset.mobileTarget;
    if (mobileTarget) setMobilePane(mobileTarget);
    const copy = event.target.closest("[data-copy]")?.dataset.copy;
    if (copy) void copySelected(copy);
  });

  let searchTimer;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = search.value;
      renderSessions();
      renderRequests();
    }, 100);
  });

  providerFilter.addEventListener("change", () => {
    state.providerFilter = providerFilter.value;
    renderRequests();
  });
  statusFilter.addEventListener("change", () => {
    state.statusFilter = statusFilter.value;
    renderRequests();
  });

  followButton.addEventListener("click", () => {
    state.follow = !state.follow;
    if (state.follow) {
      const id = sortedExchanges()[0]?.id || state.selectedExchangeId;
      state.selectedExchangeId = id;
      if (id) state.selectedNode = { kind: "generation", id: `gen-${id}` };
    }
    renderStatic();
    renderRequests();
    renderInspector();
  });

  batchModeButton.addEventListener("click", () => {
    state.batchMode = !state.batchMode;
    if (!state.batchMode) state.selectedSessionKeys.clear();
    renderSessions();
    renderSessionContext();
  });
  selectAllSessions.addEventListener("click", () => {
    const sessions = visibleSessions();
    const clear = sessions.length > 0 && sessions.every((session) => state.selectedSessionKeys.has(session.key));
    for (const session of sessions) {
      if (clear) state.selectedSessionKeys.delete(session.key);
      else state.selectedSessionKeys.add(session.key);
    }
    renderSessions();
  });
  batchExportSessions.addEventListener("click", () => {
    const keys = [...state.selectedSessionKeys];
    if (!keys.length) return;
    const link = document.createElement("a");
    link.href = historyBatchDownloadUrl(keys);
    link.download = "";
    document.body.append(link);
    link.click();
    link.remove();
    showToast(t("batchExported", { count: keys.length }));
  });
  batchDeleteSessions.addEventListener("click", () => { void deleteSelectedSessions(); });
  toggleSessionsButton.addEventListener("click", () => toggleDesktopPane("sessions"));
  toggleRequestsButton.addEventListener("click", () => toggleDesktopPane("requests"));

  document.getElementById("themeButton").addEventListener("click", toggleTheme);
  document.getElementById("localeButton").addEventListener("click", () => {
    setLocale(currentLocale() === "zh" ? "en" : "zh");
    applyStaticText();
    renderAll();
  });
  document.getElementById("refreshButton").addEventListener("click", async () => {
    await refreshSessions({ reloadCurrent: true });
    showToast(t("refreshDone"));
  });
  document.getElementById("connectionState").addEventListener("click", () => {
    if (state.selectedSessionKey) connectTraceStream(state.selectedSessionKey);
  });
  document.getElementById("deleteSession").addEventListener("click", async () => {
    if (!state.selectedSessionKey || !window.confirm(t("confirmDelete"))) return;
    await deleteSessionRequest(state.selectedSessionKey);
    closeTraceStream();
    state.selectedSessionKey = null;
    resetSessionTrace();
    showToast(t("deleted"));
    setMobilePane("sessions");
    await refreshSessions();
  });

  document.addEventListener("keydown", (event) => {
    const editing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
    if ((event.key === "/" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")) && !editing) {
      event.preventDefault();
      search.focus();
      search.select();
    }
    if (event.key === "Escape" && document.activeElement === search) search.blur();
  });

  window.addEventListener("beforeunload", () => {
    closeTraceStream();
    sessionLoadController?.abort();
    clearTimeout(requestListTimer);
  });
}

async function bootstrap() {
  try {
    const mode = localStorage.getItem("pi-trace-list-mode");
    if (mode === "requests" || mode === "turns") state.listMode = mode;
  } catch {}
  applyDesktopLayout();
  bindEvents();
  bindPaneResizers();
  renderStatic();
  renderAll();
  await refreshSessions();
}

bootstrap().catch((error) => {
  state.loadingSessions = false;
  state.loadingHistory = false;
  state.error = error instanceof Error ? error.message : String(error);
  renderAll();
});
