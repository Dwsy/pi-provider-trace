import {
  deleteSession as deleteSessionRequest,
  fetchHistory,
  fetchMetrics,
  fetchOverview,
  fetchSessions,
  fetchStatus,
  fixtureServed,
  historyBatchDownloadUrl,
  openTraceStream,
} from "./api.js";
import { applyStaticText, currentLocale, setLocale, t } from "./i18n.js";
import {
  OVERVIEW_WINDOWS,
  RENDER_PAGE,
  ingestRecord,
  parseBody,
  rawEvidence,
  resetRenderLimits,
  resetSessionTrace,
  selectTreeNode,
  selectedExchange,
  selectedTreeNode,
  sortedExchanges,
  state,
  visibleSessions,
} from "./model.js";
import { prettyJson } from "./format.js";
import { renderOverview } from "./overview.js";
import {
  announce,
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
const inspectorPane = document.querySelector(".inspector-pane");
const overviewButton = document.getElementById("overviewButton");
const overviewWindow = document.getElementById("overviewWindow");
const overviewBody = document.getElementById("overviewBody");
const shortcutsDialog = document.getElementById("shortcutsDialog");
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
let overviewController = null;
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

function surfaceFromHash() {
  return location.hash.replace(/^#\/?/, "") === "overview" ? "overview" : "workbench";
}

function applySurface() {
  app.dataset.surface = state.surface;
  overviewButton.setAttribute("aria-pressed", String(state.surface === "overview"));
}

function setSurface(surface) {
  state.surface = surface === "overview" ? "overview" : "workbench";
  const hash = state.surface === "overview" ? "#overview" : "";
  if (location.hash !== hash) {
    if (hash) location.hash = hash;
    else history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
  applySurface();
  if (state.surface === "overview") {
    if (!state.overview.data && !state.overview.loading) void loadOverview();
    else renderOverview();
    document.getElementById("overviewTitle")?.focus?.();
  }
}

async function loadOverview({ force = false } = {}) {
  const overview = state.overview;
  overviewController?.abort();
  const controller = new AbortController();
  overviewController = controller;
  overview.loading = true;
  overview.error = null;
  if (force) overview.data = null;
  renderOverview();
  try {
    overview.data = await fetchOverview(overview.window, controller.signal);
    overview.fixture = fixtureServed();
  } catch (error) {
    if (error?.name === "AbortError") return;
    overview.data = null;
    overview.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (overviewController === controller) {
      overview.loading = false;
      renderOverview();
    }
  }
}

function selectOverviewWindow(windowKey) {
  if (!OVERVIEW_WINDOWS.includes(windowKey) || windowKey === state.overview.window) return;
  state.overview.window = windowKey;
  try { localStorage.setItem("pi-trace-overview-window", windowKey); } catch {}
  void loadOverview({ force: true });
}

function toggleOverviewSort(token) {
  const [scope, key] = String(token || "").split(":");
  const sort = state.overview.sort[scope];
  if (!sort || !key) return;
  const textColumn = key === "key" || key === "provider" || key === "label";
  sort.direction = sort.key === key ? (sort.direction === "asc" ? "desc" : "asc") : textColumn ? "asc" : "desc";
  sort.key = key;
  renderOverview();
}

function openSessionFromOverview(sessionKey) {
  setSurface("workbench");
  if (sessionKey === state.selectedSessionKey && state.exchanges.size) {
    setMobilePane("requests");
    return;
  }
  void loadSession(sessionKey);
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
      announce(state.error ? t("loadFailed") : t("requestsLoaded", { count: sortedExchanges().length }));
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

function setListMode(mode) {
  state.listMode = mode === "requests" ? "requests" : "turns";
  try { localStorage.setItem("pi-trace-list-mode", state.listMode); } catch {}
  renderSessionContext();
  renderRequests();
  renderInspector();
}

/** Recovery path out of an empty result: put the controls back where the user can see they changed. */
function clearNarrowing(includeFilters) {
  state.query = "";
  search.value = "";
  if (includeFilters) {
    state.providerFilter = "";
    state.statusFilter = "";
    providerFilter.value = "";
    statusFilter.value = "";
  }
  resetRenderLimits();
  renderSessions();
  renderRequests();
  search.focus();
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

/** Resolves a `data-copy` kind against whatever the inspector is currently showing. */
function copyValue(kind) {
  if (kind === "sessionKey") return state.selectedSessionKey || "";
  const treeNode = selectedTreeNode();
  if (kind === "tool-args") return treeNode?.args == null ? "" : prettyJson(treeNode.args);
  if (kind === "tool-result") {
    const result = treeNode?.result;
    return result?.contentText ?? result?.resultText ?? (result ? prettyJson(result) : "");
  }
  if (kind === "raw" && treeNode?.kind === "message") return prettyJson(treeNode.message || treeNode);
  const exchange = selectedExchange();
  if (!exchange) return "";
  if (kind === "payload") return prettyJson(parseBody(exchange));
  if (kind === "raw") return prettyJson(rawEvidence(exchange));
  if (kind === "output") return exchange.stream?.text || "";
  return "";
}

async function copySelected(kind) {
  const text = copyValue(kind);
  if (!text) {
    showToast(t("nothingToCopy"));
    return;
  }
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
  announce(t("copied"));
}

const ROW_SELECTOR = ".session-row, .request-row, .tree-row, .table-link";

function activePane() {
  const focused = document.activeElement;
  if (sessionList.contains(focused)) return "sessions";
  if (requestList.contains(focused)) return "requests";
  if (inspectorPane.contains(focused)) return "inspector";
  return state.selectedSessionKey ? "requests" : "sessions";
}

function paneRows(pane) {
  const host = state.surface === "overview" ? overviewBody : pane === "sessions" ? sessionList : requestList;
  return [...host.querySelectorAll(ROW_SELECTOR)];
}

/** j/k and the arrow keys move real DOM focus, so Enter, the focus ring, and screen readers all follow. */
function moveRowFocus(delta) {
  const pane = state.surface === "overview" ? "overview" : activePane() === "sessions" ? "sessions" : "requests";
  const rows = paneRows(pane);
  if (!rows.length) return;
  const current = document.activeElement?.closest?.(ROW_SELECTOR);
  const index = current ? rows.indexOf(current) : -1;
  const next = index < 0
    ? (delta > 0 ? 0 : rows.length - 1)
    : Math.min(rows.length - 1, Math.max(0, index + delta));
  rows[next].focus();
  rows[next].scrollIntoView({ block: "nearest" });
}

function focusPaneRow(pane) {
  const rows = paneRows(pane);
  const current = rows.find((row) => row.getAttribute("aria-current") === "true");
  (current || rows[0])?.focus();
}

/** Escape walks back out: overview → workbench, inspector → requests → sessions. */
function stepBack() {
  if (state.surface === "overview") {
    setSurface("workbench");
    return;
  }
  const target = activePane() === "inspector" ? "requests" : "sessions";
  setMobilePane(target);
  focusPaneRow(target);
}

function moveTabFocus(delta) {
  const tabs = [...inspectorTabs.querySelectorAll("[data-tab]")];
  const index = tabs.findIndex((tab) => tab.dataset.tab === state.activeTab);
  const next = tabs[(index + delta + tabs.length) % tabs.length];
  if (!next) return;
  state.activeTab = next.dataset.tab;
  renderInspector();
  next.focus();
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
    if (button) setListMode(button.dataset.listMode);
  });

  inspectorTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (!tab) return;
    state.activeTab = tab.dataset.tab;
    renderInspector();
  });

  inspectorTabs.addEventListener("keydown", (event) => {
    const steps = { ArrowRight: 1, ArrowLeft: -1 };
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const tabs = [...inspectorTabs.querySelectorAll("[data-tab]")];
      const target = event.key === "Home" ? tabs[0] : tabs[tabs.length - 1];
      state.activeTab = target.dataset.tab;
      renderInspector();
      target.focus();
      return;
    }
    if (!(event.key in steps)) return;
    event.preventDefault();
    moveTabFocus(steps[event.key]);
  });

  overviewWindow.addEventListener("click", (event) => {
    const button = event.target.closest("[data-window]");
    if (button) selectOverviewWindow(button.dataset.window);
  });

  overviewBody.addEventListener("click", (event) => {
    const sort = event.target.closest("[data-sort]");
    if (sort) {
      toggleOverviewSort(sort.dataset.sort);
      return;
    }
    const open = event.target.closest("[data-overview-session]");
    if (open) {
      openSessionFromOverview(open.dataset.overviewSession);
      return;
    }
    const row = event.target.closest("tr[data-session-key]");
    if (row) openSessionFromOverview(row.dataset.sessionKey);
  });

  overviewButton.addEventListener("click", () => {
    setSurface(state.surface === "overview" ? "workbench" : "overview");
  });

  document.addEventListener("click", (event) => {
    const mobileTarget = event.target.closest("[data-mobile-target]")?.dataset.mobileTarget;
    if (mobileTarget) setMobilePane(mobileTarget);
    const copy = event.target.closest("[data-copy]")?.dataset.copy;
    if (copy) void copySelected(copy);
    const more = event.target.closest("[data-show-more]")?.dataset.showMore;
    if (more) {
      state.renderLimits[more] += more === "prompts" ? 12 : RENDER_PAGE;
      if (more === "sessions") renderSessions();
      else renderRequests();
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "open-overview") setSurface("overview");
    if (action === "close-overview") setSurface("workbench");
    if (action === "overview-retry") void loadOverview({ force: true });
    if (action === "close-shortcuts") shortcutsDialog.close();
    if (action === "clear-search" || action === "clear-filters") clearNarrowing(action === "clear-filters");
    if (action === "switch-to-requests") setListMode("requests");
  });

  let searchTimer;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = search.value;
      resetRenderLimits();
      renderSessions();
      renderRequests();
    }, 100);
  });

  providerFilter.addEventListener("change", () => {
    state.providerFilter = providerFilter.value;
    state.renderLimits.requests = RENDER_PAGE;
    renderRequests();
  });
  statusFilter.addEventListener("change", () => {
    state.statusFilter = statusFilter.value;
    state.renderLimits.requests = RENDER_PAGE;
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
  document.getElementById("shortcutsButton").addEventListener("click", () => {
    if (!shortcutsDialog.open) shortcutsDialog.showModal();
  });
  document.getElementById("localeButton").addEventListener("click", () => {
    setLocale(currentLocale() === "zh" ? "en" : "zh");
    applyStaticText();
    renderAll();
    renderOverview();
  });
  document.getElementById("refreshButton").addEventListener("click", async () => {
    if (state.surface === "overview") {
      await loadOverview({ force: true });
      showToast(t("refreshDone"));
      return;
    }
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
      return;
    }
    if (event.key === "Escape") {
      if (shortcutsDialog.open) return;
      if (document.activeElement === search) {
        search.blur();
        return;
      }
      stepBack();
      return;
    }
    if (editing || shortcutsDialog.open || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "?") {
      event.preventDefault();
      if (!shortcutsDialog.open) shortcutsDialog.showModal();
      return;
    }
    if (event.key === "o") {
      event.preventDefault();
      setSurface(state.surface === "overview" ? "workbench" : "overview");
      return;
    }
    // Arrows only traverse rows from a row or from nowhere; inside a scrollable panel or
    // the chart they keep their native meaning.
    const onRow = Boolean(document.activeElement?.closest?.(ROW_SELECTOR));
    const idle = !document.activeElement || document.activeElement === document.body;
    const arrows = onRow || idle;
    if (event.key === "j" || (event.key === "ArrowDown" && arrows)) {
      event.preventDefault();
      moveRowFocus(1);
      return;
    }
    if (event.key === "k" || (event.key === "ArrowUp" && arrows)) {
      event.preventDefault();
      moveRowFocus(-1);
    }
  });

  window.addEventListener("hashchange", () => {
    const surface = surfaceFromHash();
    if (surface !== state.surface) setSurface(surface);
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
    const overviewWindowKey = localStorage.getItem("pi-trace-overview-window");
    if (OVERVIEW_WINDOWS.includes(overviewWindowKey)) state.overview.window = overviewWindowKey;
  } catch {}
  state.surface = surfaceFromHash();
  applySurface();
  applyDesktopLayout();
  bindEvents();
  bindPaneResizers();
  renderStatic();
  renderAll();
  if (state.surface === "overview") void loadOverview();
  await refreshSessions();
}

bootstrap().catch((error) => {
  state.loadingSessions = false;
  state.loadingHistory = false;
  state.error = error instanceof Error ? error.message : String(error);
  renderAll();
});
