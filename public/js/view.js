import { t, applyStaticText } from "./i18n.js";
import {
  availableProviders,
  buildSessionTree,
  exchangeDuration,
  exchangeState,
  exchangeTtft,
  linkedPiEvents,
  messagesForExchange,
  modelFor,
  parseBody,
  providerFor,
  rawEvidence,
  requestParametersForExchange,
  selectedExchange,
  selectedSession,
  selectedTreeNode,
  sessionStats,
  sessionTreeStats,
  state,
  timelineForExchange,
  toolCallsForExchange,
  toolDefinitionsForExchange,
  visibleExchanges,
  visibleSessions,
} from "./model.js";
import {
  endpointPath,
  formatBytes,
  formatClock,
  formatCost,
  formatDuration,
  formatTimestamp,
  formatTokens,
  prettyJson,
  truncate,
} from "./format.js";

const elements = {
  app: document.getElementById("app"),
  sessionCount: document.getElementById("sessionCount"),
  sessionList: document.getElementById("sessionList"),
  sessionActions: document.getElementById("sessionActions"),
  sessionBatchActions: document.getElementById("sessionBatchActions"),
  batchModeButton: document.getElementById("batchModeButton"),
  selectAllSessions: document.getElementById("selectAllSessions"),
  selectAllSessionsLabel: document.getElementById("selectAllSessionsLabel"),
  batchSelectionLabel: document.getElementById("batchSelectionLabel"),
  batchExportSessions: document.getElementById("batchExportSessions"),
  batchDeleteSessions: document.getElementById("batchDeleteSessions"),
  exportSession: document.getElementById("exportSession"),
  sessionKeyLabel: document.getElementById("sessionKeyLabel"),
  sessionTitle: document.getElementById("sessionTitle"),
  sessionSummary: document.getElementById("sessionSummary"),
  providerFilter: document.getElementById("providerFilter"),
  statusFilter: document.getElementById("statusFilter"),
  requestList: document.getElementById("requestList"),
  inspectorIdentity: document.getElementById("inspectorIdentity"),
  inspectorMetrics: document.getElementById("inspectorMetrics"),
  inspectorTabs: document.getElementById("inspectorTabs"),
  inspectorPanel: document.getElementById("inspectorPanel"),
  followButton: document.getElementById("followButton"),
  connectionState: document.getElementById("connectionState"),
  connectionLabel: document.getElementById("connectionLabel"),
  toast: document.getElementById("toast"),
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = String(text);
  return element;
}

function append(host, ...children) {
  host.append(...children.filter(Boolean));
}

function replace(host, ...children) {
  host.replaceChildren(...children.filter(Boolean));
}

function emptyState(title, hint, error = false) {
  const root = node("div", error ? "error-state" : "empty-state");
  root.append(node("span", "empty-rule"), node("h2", "", title), node("p", "", hint));
  return root;
}

function skeleton(count = 6) {
  const root = node("div", "skeleton-list");
  for (let index = 0; index < count; index += 1) {
    const row = node("div", "skeleton-row");
    row.append(node("div", "skeleton-line medium"), node("div", "skeleton-line"), node("div", "skeleton-line short"));
    root.append(row);
  }
  return root;
}

function stateLabel(value) {
  if (value === "live") return t("streaming");
  if (value === "error") return t("failed");
  if (value === "ok") return t("success");
  return t("waiting");
}

export function renderConnection() {
  elements.connectionState.dataset.state = state.connection;
  elements.connectionLabel.textContent = t(state.connection === "live" ? "connected" : state.connection);
}

export function renderStatic() {
  applyStaticText();
  renderConnection();
  elements.followButton.setAttribute("aria-pressed", String(state.follow));
}

export function renderSessions() {
  const knownKeys = new Set(state.sessions.map((session) => session.key));
  for (const key of state.selectedSessionKeys) {
    if (!knownKeys.has(key)) state.selectedSessionKeys.delete(key);
  }
  const visible = visibleSessions();
  const visibleSelected = visible.filter((session) => state.selectedSessionKeys.has(session.key)).length;
  const allVisibleSelected = visible.length > 0 && visibleSelected === visible.length;
  elements.sessionList.classList.toggle("is-batch-mode", state.batchMode);
  elements.batchModeButton.setAttribute("aria-pressed", String(state.batchMode));
  elements.batchModeButton.textContent = t(state.batchMode ? "done" : "batchManage");
  elements.sessionBatchActions.hidden = !state.batchMode;
  elements.selectAllSessions.setAttribute("aria-pressed", String(allVisibleSelected));
  elements.selectAllSessionsLabel.textContent = allVisibleSelected
    ? t("clearVisible")
    : t("selectVisible");
  elements.batchSelectionLabel.textContent = t("selectedCount", { count: state.selectedSessionKeys.size });
  elements.batchExportSessions.disabled = state.selectedSessionKeys.size === 0;
  elements.batchDeleteSessions.disabled = state.selectedSessionKeys.size === 0;

  elements.sessionCount.textContent = String(state.sessions.length);
  if (state.loadingSessions) {
    replace(elements.sessionList, skeleton(7));
    return;
  }
  if (state.error && !state.sessions.length) {
    replace(elements.sessionList, emptyState(t("loadFailed"), t("retryHint"), true));
    return;
  }
  const sessions = visible;
  if (!sessions.length) {
    replace(elements.sessionList, emptyState(t("noSessions"), t("noSessionsHint")));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const session of sessions) {
    const item = node("div", "session-item");
    item.dataset.sessionKey = session.key;
    const selection = node("button", "session-select");
    selection.type = "button";
    selection.dataset.sessionSelect = session.key;
    selection.setAttribute("role", "checkbox");
    selection.setAttribute("aria-checked", String(state.selectedSessionKeys.has(session.key)));
    selection.setAttribute("aria-label", t("selectSession", { name: session.label || session.key }));
    selection.append(node("span", "selection-box"));
    const button = node("button", "session-row");
    button.type = "button";
    button.dataset.sessionKey = session.key;
    button.setAttribute("aria-current", String(session.key === state.selectedSessionKey));
    const head = node("div", "session-row-head");
    head.append(node("span", "session-name", session.label || session.key), node("span", "count-label", session.records || 0));
    button.append(
      head,
      node("div", "session-key", session.key),
      node("div", "session-meta", `${formatTimestamp(session.lastTs)} · ${formatBytes(session.httpLogBytes || 0)}`),
    );
    item.append(selection, button);
    fragment.append(item);
  }
  replace(elements.sessionList, fragment);
}

function summaryMetric(value, label) {
  const root = node("div", "summary-metric");
  root.append(node("strong", "", value), node("span", "", label));
  return root;
}

function updateProviderFilter() {
  const current = state.providerFilter;
  const first = node("option", "", t("allProviders"));
  first.value = "";
  const options = [first];
  for (const provider of availableProviders()) {
    const option = node("option", "", provider);
    option.value = provider;
    options.push(option);
  }
  replace(elements.providerFilter, ...options);
  if (options.some((option) => option.value === current)) {
    elements.providerFilter.value = current;
  } else {
    state.providerFilter = "";
    elements.providerFilter.value = "";
  }
  elements.statusFilter.value = state.statusFilter;
}

export function renderSessionContext() {
  const session = selectedSession();
  elements.sessionKeyLabel.textContent = session?.key || "—";
  elements.sessionTitle.textContent = session?.label || (state.listMode === "turns" ? t("turns") : t("requests"));
  elements.sessionActions.hidden = !session || state.batchMode;
  if (session) elements.exportSession.href = `/api/download?session=${encodeURIComponent(session.key)}&file=http-sse`;
  const stats = sessionStats();
  const treeStats = sessionTreeStats();
  replace(
    elements.sessionSummary,
    summaryMetric(treeStats.prompts || stats.requests, t("prompts")),
    summaryMetric(treeStats.turns, t("turnCount")),
    summaryMetric(formatTokens(stats.tokens), t("tokens")),
    summaryMetric(formatCost(stats.cost), t("cost")),
  );
  updateProviderFilter();
  updateListModeToggle();
}

function updateListModeToggle() {
  const host = document.getElementById("listModeToggle");
  if (!host) return;
  host.querySelectorAll("[data-list-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.listMode === state.listMode));
  });
}

function isSelectedNode(kind, id) {
  return state.selectedNode?.kind === kind && state.selectedNode?.id === id;
}

function treeToggle(scope, id, collapsed) {
  const button = node("button", "tree-toggle");
  button.type = "button";
  button.dataset.treeToggle = `${scope}:${id}`;
  button.dataset.collapsed = String(collapsed);
  button.setAttribute("aria-expanded", String(!collapsed));
  button.textContent = collapsed ? "▸" : "▾";
  return button;
}

function renderTurnTree() {
  const tree = buildSessionTree();
  if (!tree.prompts.length) {
    replace(elements.requestList, emptyState(t("noTurns"), t("noTurnsHint")));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const prompt of tree.prompts) {
    const promptCollapsed = state.collapsedPrompts.has(prompt.id);
    const promptBlock = node("div", "tree-prompt");
    const promptRow = node("button", "tree-row prompt-row");
    promptRow.type = "button";
    promptRow.dataset.nodeKind = "prompt";
    promptRow.dataset.nodeId = prompt.id;
    promptRow.setAttribute("aria-current", String(isSelectedNode("prompt", prompt.id) || isSelectedNode("input", prompt.id)));
    const promptHead = node("div", "tree-row-head");
    promptHead.append(
      treeToggle("prompt", prompt.id, promptCollapsed),
      node("span", "tree-kind prompt", t("prompt")),
      node("span", "tree-title", truncate(prompt.input || t("emptyPrompt"), 72)),
    );
    const promptMeta = node("div", "tree-meta", `${prompt.turns.length} ${t("turnCount")} · ${formatTimestamp(prompt.startTs)}`);
    promptRow.append(promptHead, promptMeta);
    promptBlock.append(promptRow);

    if (!promptCollapsed) {
      for (const turn of prompt.turns) {
        const turnCollapsed = state.collapsedTurns.has(turn.id);
        const turnBlock = node("div", "tree-turn");
        const turnRow = node("button", "tree-row turn-row");
        turnRow.type = "button";
        turnRow.dataset.nodeKind = "turn";
        turnRow.dataset.nodeId = turn.id;
        turnRow.setAttribute("aria-current", String(isSelectedNode("turn", turn.id)));
        const turnHead = node("div", "tree-row-head");
        append(
          turnHead,
          treeToggle("turn", turn.id, turnCollapsed),
          node("span", "tree-kind turn", `T${turn.turnIndex}`),
          node("span", "tree-title", turn.stopReason || t("turn")),
          turn.usage ? node("span", "tree-badge", formatTokens(turn.usage.totalTokens)) : null,
        );
        turnRow.append(
          turnHead,
          node("div", "tree-meta", `${turn.nodes.length} nodes · ${formatTimestamp(turn.startTs)}`),
        );
        turnBlock.append(turnRow);

        if (!turnCollapsed) {
          for (const child of turn.nodes) {
            turnBlock.append(renderTreeChild(child));
          }
        }
        promptBlock.append(turnBlock);
      }
      for (const orphan of prompt.orphanNodes || []) {
        promptBlock.append(renderTreeChild(orphan));
      }
    }
    fragment.append(promptBlock);
  }
  replace(elements.requestList, fragment);
}

function renderTreeChild(child) {
  const row = node("button", `tree-row node-row ${child.kind}`);
  row.type = "button";
  row.dataset.nodeKind = child.kind;
  row.dataset.nodeId = child.id;
  if (child.exchangeId) row.dataset.exchangeId = child.exchangeId;
  row.setAttribute("aria-current", String(isSelectedNode(child.kind, child.id)));

  if (child.kind === "generation") {
    const ex = child.exchange;
    const status = exchangeState(ex);
    const head = node("div", "tree-row-head");
    head.append(
      node("span", "tree-kind gen", "LLM"),
      node("span", "tree-title", modelFor(ex)),
      node("span", `state-tag ${status}`, stateLabel(status)),
    );
    row.append(
      head,
      node("div", "tree-meta", `${formatDuration(exchangeDuration(ex))} · ${formatTokens(ex?.usage?.totalTokens)} · ${formatCost(ex?.usage?.costTotal)}`),
    );
    return row;
  }

  if (child.kind === "tool") {
    const head = node("div", "tree-row-head");
    append(
      head,
      node("span", `tree-kind tool${child.isError ? " error" : ""}`, "TOOL"),
      node("span", "tree-title", child.toolName || "?"),
      child.isError ? node("span", "state-tag error", t("failed")) : null,
    );
    const preview = truncate(
      typeof child.args === "string" ? child.args : prettyJson(child.args || child.result?.contentText || ""),
      80,
    );
    row.append(head, node("div", "tree-meta", preview));
    return row;
  }

  if (child.kind === "message") {
    const head = node("div", "tree-row-head");
    head.append(
      node("span", `tree-kind msg ${child.role || ""}`, roleName(child.role)),
      node("span", "tree-title", truncate(child.message?.text || child.stopReason || "", 72)),
    );
    row.append(head, node("div", "tree-meta", formatTimestamp(child.ts)));
    return row;
  }

  row.append(node("div", "tree-row-head", child.kind));
  return row;
}

export function renderRequests() {
  if (state.loadingHistory) {
    replace(elements.requestList, skeleton(8));
    return;
  }
  if (state.error) {
    replace(elements.requestList, emptyState(t("loadFailed"), t("retryHint"), true));
    return;
  }
  if (state.listMode === "turns") {
    renderTurnTree();
    return;
  }
  const matches = visibleExchanges();
  if (!matches.length) {
    replace(elements.requestList, emptyState(t("noRequests"), t("noRequestsHint")));
    return;
  }

  const cap = 300;
  const fragment = document.createDocumentFragment();
  for (const exchange of matches.slice(0, cap)) {
    const status = exchangeState(exchange);
    const tools = exchange.stream?.toolCalls?.length || 0;
    const button = node("button", "request-row");
    button.type = "button";
    button.dataset.exchangeId = exchange.id;
    button.setAttribute("aria-current", String(exchange.id === state.selectedExchangeId));

    const primary = node("div", "request-primary");
    primary.append(
      node("span", "method-tag", exchange.request?.method || "POST"),
      node("span", "request-model", modelFor(exchange)),
      node("span", `state-tag ${status}`, stateLabel(status)),
    );
    const path = node("div", "request-path", endpointPath(exchange.request?.url));
    const foot = node("div", "request-foot");
    const left = `${formatTimestamp(exchange.request?.ts)} · ${formatDuration(exchangeDuration(exchange))}`;
    const right = [
      tools ? `${tools} tools` : "",
      exchange.usage ? `${formatTokens(exchange.usage.totalTokens)} tok` : "",
      exchange.usage ? formatCost(exchange.usage.costTotal) : "",
    ].filter(Boolean).join(" · ") || providerFor(exchange);
    foot.append(node("span", "", left), node("span", "", right));
    button.append(primary, path, foot);
    fragment.append(button);
  }
  if (matches.length > cap) {
    const notice = node("div", "notice", t("shownLimit", { count: cap }));
    fragment.append(notice);
  }
  replace(elements.requestList, fragment);
}

function metric(value, label) {
  const root = node("div", "metric-inline");
  root.append(node("strong", "", value), node("span", "", label));
  return root;
}

export function renderInspectorHeader() {
  const treeNode = selectedTreeNode();
  if (treeNode && treeNode.kind !== "generation") {
    renderNodeHeader(treeNode);
    return;
  }
  const exchange = selectedExchange();
  if (!exchange) {
    const eyebrow = node("p", "eyebrow", t("evidenceEyebrow"));
    replace(elements.inspectorIdentity, eyebrow, node("h1", "", t("selectRequest")));
    replace(elements.inspectorMetrics);
    return;
  }
  const eyebrow = node("p", "eyebrow", `${providerFor(exchange)} · ${endpointPath(exchange.request?.url)}`);
  replace(elements.inspectorIdentity, eyebrow, node("h1", "", modelFor(exchange)));
  replace(
    elements.inspectorMetrics,
    metric(formatDuration(exchangeTtft(exchange)), t("ttft")),
    metric(formatDuration(exchangeDuration(exchange)), t("duration")),
    metric(formatTokens(exchange.usage?.totalTokens), t("tokens")),
    metric(formatCost(exchange.usage?.costTotal), t("cost")),
  );
}

function renderNodeHeader(treeNode) {
  if (treeNode.kind === "prompt" || treeNode.kind === "input") {
    replace(
      elements.inspectorIdentity,
      node("p", "eyebrow", t("prompt")),
      node("h1", "", truncate(treeNode.input || t("emptyPrompt"), 96)),
    );
    replace(
      elements.inspectorMetrics,
      metric(treeNode.turns?.length || 0, t("turnCount")),
      metric(formatTimestamp(treeNode.startTs), t("started")),
    );
    return;
  }
  if (treeNode.kind === "turn") {
    replace(
      elements.inspectorIdentity,
      node("p", "eyebrow", t("turn")),
      node("h1", "", `Turn #${treeNode.turnIndex} · ${treeNode.stopReason || t("waiting")}`),
    );
    replace(
      elements.inspectorMetrics,
      metric(treeNode.nodes?.length || 0, t("nodes")),
      metric(formatTokens(treeNode.usage?.totalTokens), t("tokens")),
      metric(formatCost(treeNode.usage?.costTotal), t("cost")),
    );
    return;
  }
  if (treeNode.kind === "tool") {
    replace(
      elements.inspectorIdentity,
      node("p", "eyebrow", t("toolCalls")),
      node("h1", "", treeNode.toolName || "tool"),
    );
    replace(
      elements.inspectorMetrics,
      metric(treeNode.isError ? t("failed") : t("success"), t("status")),
      metric(truncate(String(treeNode.toolCallId || ""), 18), t("callId")),
    );
    return;
  }
  if (treeNode.kind === "message") {
    replace(
      elements.inspectorIdentity,
      node("p", "eyebrow", roleName(treeNode.role)),
      node("h1", "", truncate(treeNode.message?.text || treeNode.stopReason || t("emptyValue"), 96)),
    );
    replace(
      elements.inspectorMetrics,
      metric(treeNode.stopReason || "—", t("status")),
      metric(formatTokens(treeNode.usage?.totalTokens), t("tokens")),
    );
  }
}

function renderTabs() {
  elements.inspectorTabs.querySelectorAll("[data-tab]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.tab === state.activeTab));
  });
}

function sectionHeading(title, meta) {
  const root = node("div", "section-heading");
  const copy = node("div");
  copy.append(node("h2", "", title));
  if (meta) copy.append(node("p", "", meta));
  root.append(copy);
  return root;
}

function stage(label, value, status) {
  const root = node("li", `stage ${status || ""}`);
  const header = node("div", "stage-header");
  header.append(node("span", "stage-dot"), node("strong", "", label));
  root.append(header, node("span", "stage-value", value || t("waiting")));
  return root;
}

function renderStages(exchange) {
  const streamState = exchangeState(exchange);
  const toolCount = exchange.stream?.toolCalls?.length || 0;
  const rail = node("ol", "stage-rail");
  rail.id = "liveStageRail";
  rail.append(
    stage(t("requestSent"), formatClock(exchange.request?.ts), exchange.request ? "done" : ""),
    stage(t("headersReceived"), exchange.response?.status ? `HTTP ${exchange.response.status}` : "", exchange.response ? "done" : streamState === "error" ? "error" : ""),
    stage(t("firstToken"), formatDuration(exchangeTtft(exchange)), exchange.stream?.firstEventTs ? "done" : streamState === "live" ? "active" : ""),
    stage(t("toolCalls"), toolCount ? String(toolCount) : streamState === "ok" ? t("notCalled") : "0", toolCount ? "done" : streamState === "ok" ? "skipped" : ""),
    stage(t("completed"), formatDuration(exchangeDuration(exchange)), streamState === "ok" ? "done" : streamState === "error" ? "error" : streamState === "live" ? "active" : ""),
  );
  return rail;
}

function roleName(role) {
  const value = String(role || "message").toLowerCase();
  const labels = {
    user: currentChinese() ? "用户" : "USER",
    assistant: currentChinese() ? "助手" : "ASSISTANT",
    system: "SYSTEM",
    developer: "DEVELOPER",
    tool: "TOOL",
    model: "MODEL",
    pi: "PI INPUT",
  };
  return labels[value] || value.toUpperCase();
}

function currentChinese() {
  return document.documentElement.dataset.locale !== "en";
}

function messageRow(message) {
  const row = node("div", "message-row");
  row.append(node("span", `role-label ${message.role || ""}`, roleName(message.role)));
  const hasEvents = Boolean(message.toolCalls?.length || message.toolResults?.length);
  const content = node("div", `message-content${message.text?.length > 3600 ? " is-scrollable" : ""}`);
  if (message.text) content.append(node("div", "message-text", message.text));
  else if (!hasEvents && !message.media?.length) content.append(node("div", "message-text", t("emptyValue")));
  if (message.media?.length) {
    const strip = node("div", "media-strip");
    for (const media of message.media) strip.append(node("span", "media-chip", media));
    content.append(strip);
  }
  if (hasEvents) {
    const events = node("div", "message-tool-events");
    for (const call of message.toolCalls || []) events.append(messageToolEvent("call", call));
    for (const result of message.toolResults || []) events.append(messageToolEvent("result", result));
    content.append(events);
  }
  row.append(content);
  return row;
}

function messageToolEvent(kind, event) {
  const isError = kind === "result" && event.isError;
  const root = node("div", `message-tool-event ${kind}${isError ? " error" : ""}`);
  const header = node("div", "message-tool-event-header");
  header.append(node("span", "message-tool-kind", t(kind === "call" ? "messageToolCall" : "messageToolResult")));
  if (event.name) header.append(node("strong", "message-tool-name", event.name));
  if (event.callId) header.append(node("span", "message-tool-id", `${t("callId")} · ${event.callId}`));
  const value = kind === "call" ? event.arguments : event.output;
  root.append(header, node("pre", "message-tool-payload", prettyJson(value || t("emptyValue"))));
  return root;
}

function contextMessages(exchange) {
  const messages = messagesForExchange(exchange);
  const input = linkedPiEvents(exchange).filter((event) => event.eventName === "input").at(-1);
  const inputText = input?.detail?.text;
  if (inputText && !messages.some((message) => message.role === "user" && message.text.includes(inputText.slice(0, 80)))) {
    messages.push({ role: "pi", text: inputText, media: [], toolCalls: [], toolResults: [] });
  }
  return messages;
}

function renderContext(exchange) {
  const section = node("section", "evidence-section");
  const messages = contextMessages(exchange);
  section.append(sectionHeading(t("piContext"), `${messages.length} messages · ${t("piContextHint")}`));
  const thread = node("div", "message-thread");
  if (!messages.length) thread.append(node("div", "notice", t("emptyValue")));
  for (const message of messages) thread.append(messageRow(message));
  section.append(thread);
  return section;
}

function streamMeta(exchange) {
  const stream = exchange.stream;
  if (!stream) return t("waiting");
  return `${stream.eventCount || 0} ${t("events")} · ${formatBytes(stream.byteCount || 0)} · ${exchange.streamDurable ? t("durableResult") : t("liveMemory")}`;
}

function renderStreamOutput(exchange) {
  const section = node("section", "evidence-section");
  const heading = sectionHeading(t("modelOutput"), t("modelOutputHint"));
  const meta = node("p", "section-meta", streamMeta(exchange));
  meta.id = "liveStreamMeta";
  heading.append(meta);
  section.append(heading);
  if (exchange.stream?.reasoning) {
    const details = node("details", "reasoning-block");
    details.id = "liveReasoning";
    details.open = true;
    details.append(node("summary", "", t("reasoning")), node("pre", "", exchange.stream.reasoning));
    section.append(details);
  }
  const output = node("pre", "stream-output", exchange.stream?.text || t("awaitingOutput"));
  output.id = "liveStreamOutput";
  output.classList.toggle("is-empty", !exchange.stream?.text);
  output.classList.toggle("is-live", exchangeState(exchange) === "live");
  section.append(output);
  return section;
}

function toolCallDetails(call, index) {
  const details = node("details", "tool-call");
  details.open = call.state === "streaming";
  details.dataset.toolKey = call.key;
  const summary = document.createElement("summary");
  const heading = node("div", "tool-call-heading");
  const stateValue = call.result ? "ok" : call.state === "streaming" ? "live" : "";
  const stateText = call.result ? t("success") : call.state === "streaming" ? t("streaming") : t("waiting");
  heading.append(
    node("span", "tool-index", String(index + 1).padStart(2, "0")),
    node("span", "tool-name", call.name || "unknown_tool"),
    node("span", `tool-state ${stateValue}`, stateText),
  );
  summary.append(heading);
  const body = node("div", "tool-call-body");
  const args = node("div");
  args.append(node("span", "tool-code-label", t("arguments")), node("pre", "tool-code", prettyJson(call.arguments || "{}")));
  args.querySelector("pre").dataset.toolArguments = call.key;
  const result = node("div");
  result.append(
    node("span", "tool-code-label", t("result")),
    node("pre", "tool-code", call.result?.output || t("noResult")),
  );
  body.append(args, result);
  details.append(summary, body);
  return details;
}

function renderTools(exchange) {
  const calls = toolCallsForExchange(exchange);
  if (!calls.length) return null;
  const section = node("section", "evidence-section");
  section.id = "liveToolSection";
  section.append(sectionHeading(t("toolCalls"), `${calls.length}`));
  const list = node("div", "tool-call-list");
  for (const [index, call] of calls.entries()) list.append(toolCallDetails(call, index));
  section.append(list);
  return section;
}

function renderFlow(exchange) {
  const view = node("div", "evidence-view");
  const overview = node("section", "flow-overview");
  const titleRow = node("div", "flow-title-row");
  const copy = node("div");
  copy.append(node("h2", "", t("flowTitle")), node("p", "", t("flowHint")));
  const flowState = node("span", "flow-state");
  flowState.id = "liveFlowState";
  flowState.append(node("span", "status-dot"), node("span", "", stateLabel(exchangeState(exchange))));
  const flowStateClass = exchangeState(exchange) === "error" ? "status-error" : exchangeState(exchange) === "live" ? "status-live" : null;
  if (flowStateClass) flowState.classList.add(flowStateClass);
  titleRow.append(copy, flowState);
  overview.append(titleRow, renderStages(exchange));
  view.append(overview, renderContext(exchange), renderStreamOutput(exchange));
  const tools = renderTools(exchange);
  if (tools) view.append(tools);
  return view;
}

function copyButton(kind) {
  const button = node("button", "copy-button", t("copy"));
  button.type = "button";
  button.dataset.copy = kind;
  return button;
}

function codeSection(title, meta, text, copyKind) {
  const section = node("section", "evidence-section");
  const heading = node("div", "code-heading");
  const copy = node("div");
  copy.append(node("h2", "", title));
  if (meta) copy.append(node("p", "section-meta", meta));
  heading.append(copy);
  if (copyKind) heading.append(copyButton(copyKind));
  section.append(heading, node("pre", "code-block", text));
  return section;
}

function renderPayload(exchange) {
  const view = node("div", "evidence-view");
  view.append(renderRequestParameters(exchange));
  view.append(renderToolDefinitions(exchange));
  view.append(renderContext(exchange));
  view.append(codeSection(t("requestPayload"), `${exchange.request?.method || "POST"} · ${endpointPath(exchange.request?.url)}`, prettyJson(parseBody(exchange)), "payload"));
  return view;
}

function renderRequestParameters(exchange) {
  const parameters = requestParametersForExchange(exchange);
  const section = node("section", "evidence-section input-parameters-section");
  section.append(sectionHeading(t("requestParameters"), `${parameters.length} · ${t("requestParametersHint")}`));
  if (!parameters.length) {
    section.append(node("div", "notice", t("emptyValue")));
    return section;
  }
  const grid = node("div", "parameter-grid");
  for (const parameter of parameters) {
    const complex = parameter.value !== null && typeof parameter.value === "object";
    const item = node("div", `parameter-item${complex ? " is-complex" : ""}`);
    item.dataset.parameter = parameter.key;
    item.append(node("span", "parameter-key", parameter.key));
    item.append(complex
      ? node("pre", "parameter-json", prettyJson(parameter.value))
      : node("strong", "parameter-value", parameter.value == null ? "null" : String(parameter.value)));
    grid.append(item);
  }
  section.append(grid);
  return section;
}

function renderToolDefinitions(exchange) {
  const definitions = toolDefinitionsForExchange(exchange);
  const section = node("section", "evidence-section input-tools-section");
  section.append(sectionHeading(t("availableTools"), `${definitions.length} · ${t("availableToolsHint")}`));
  if (!definitions.length) {
    section.append(node("div", "notice", t("noTools")));
    return section;
  }
  const list = node("div", "tool-definition-list");
  for (const [index, definition] of definitions.entries()) {
    const details = node("details", "tool-definition");
    details.dataset.toolDefinition = definition.name;
    if (definitions.length <= 2 && index === 0) details.open = true;
    const summary = document.createElement("summary");
    const heading = node("div", "tool-definition-heading");
    const required = Array.isArray(definition.parameters?.required) ? definition.parameters.required.length : 0;
    heading.append(
      node("span", "tool-definition-index", String(index + 1).padStart(2, "0")),
      node("span", "tool-definition-name", definition.name),
      node("span", "provider-tag", definition.type),
    );
    if (required) heading.append(node("span", "tool-definition-meta", t("requiredFields", { count: required })));
    summary.append(heading);
    const body = node("div", "tool-definition-body");
    if (definition.description) body.append(node("p", "tool-definition-description", definition.description));
    body.append(node("span", "tool-code-label", t("toolSchema")), node("pre", "tool-code tool-definition-schema", prettyJson(definition.parameters)));
    details.append(summary, body);
    list.append(details);
  }
  section.append(list);
  return section;
}

function kvTable(entries) {
  const table = node("table", "kv-table");
  const body = document.createElement("tbody");
  for (const [key, value] of entries) {
    const row = document.createElement("tr");
    row.append(node("th", "", key), node("td", "", value == null || value === "" ? "—" : String(value)));
    body.append(row);
  }
  table.append(body);
  return table;
}

function renderRequestHeaders(exchange) {
  const view = node("div", "evidence-view");
  const metadata = node("section", "evidence-section");
  metadata.append(sectionHeading(t("requestMetadata")));
  metadata.append(kvTable([
    [t("method"), exchange.request?.method],
    [t("endpoint"), exchange.request?.url],
    [t("requestId"), exchange.id],
  ]));
  const headers = node("section", "evidence-section");
  const entries = Object.entries(exchange.request?.headers || {});
  headers.append(sectionHeading(t("requestHeaders"), t("requestHeadersHint")));
  headers.append(entries.length ? kvTable(entries) : node("div", "notice", t("emptyValue")));
  view.append(metadata, headers);
  return view;
}

function renderResponseMeta(exchange) {
  const view = node("div", "evidence-view");
  const response = node("section", "evidence-section");
  response.append(sectionHeading(t("responseHeaders"), exchange.response ? `HTTP ${exchange.response.status}` : t("waiting")));
  response.append(kvTable(Object.entries(exchange.response?.headers || {})));
  const stream = exchange.stream;
  const summary = node("section", "evidence-section");
  summary.append(sectionHeading(t("streamSummary"), streamMeta(exchange)));
  summary.append(kvTable([
    [t("status"), stream?.state],
    [t("events"), stream?.eventCount],
    [t("bytes"), formatBytes(stream?.byteCount)],
    [t("ttft"), formatDuration(exchangeTtft(exchange))],
    [t("duration"), formatDuration(exchangeDuration(exchange))],
    ["finishReason", stream?.finishReason],
  ]));
  view.append(response, summary);
  return view;
}

function renderResponse(exchange) {
  const view = node("div", "evidence-view");
  view.append(renderStreamOutput(exchange));
  const tools = renderTools(exchange);
  if (tools) view.append(tools);
  return view;
}

function timelineLabel(record) {
  if (record.kind === "pi_event") return record.eventName || "pi_event";
  return record.kind;
}

function timelineSummary(record) {
  if (record.summary) return record.summary;
  if (record.kind === "request") return `${record.method || "POST"} ${endpointPath(record.url)}`;
  if (record.kind === "response_meta") return `HTTP ${record.status}`;
  if (record.kind === "stream_update" || record.kind === "stream_result") {
    return `${record.stream?.eventCount || 0} events · ${truncate(record.stream?.text || record.stream?.finishReason || "", 160)}`;
  }
  if (record.kind === "llm_usage") return `${record.usage?.input || 0} in · ${record.usage?.output || 0} out · ${formatCost(record.usage?.costTotal)}`;
  if (record.kind === "error") return record.message || t("failed");
  return timelineLabel(record);
}

function renderTimeline(exchange) {
  const view = node("div", "evidence-view");
  const section = node("section", "evidence-section");
  section.append(sectionHeading(t("linkedTimeline"), `${timelineForExchange(exchange).length} ${t("events")}`));
  const timeline = node("div", "timeline");
  for (const record of timelineForExchange(exchange)) {
    const row = node("div", "timeline-row");
    row.append(
      node("span", "timeline-time", formatClock(record.ts)),
      node("span", "timeline-kind", timelineLabel(record)),
      node("span", "timeline-summary", timelineSummary(record)),
    );
    timeline.append(row);
  }
  section.append(timeline);
  view.append(section);
  return view;
}

function renderRaw(exchange) {
  const view = node("div", "evidence-view");
  view.append(codeSection(t("rawEvidence"), exchange.id, prettyJson(rawEvidence(exchange)), "raw"));
  return view;
}

function renderNodeContent(treeNode) {
  const view = node("div", "evidence-view");

  if (treeNode.kind === "prompt" || treeNode.kind === "input") {
    const section = node("section", "evidence-section");
    section.append(sectionHeading(t("userInput"), treeNode.inputSource || ""));
    section.append(node("pre", "stream-output", treeNode.input || t("emptyPrompt")));
    view.append(section);
    const turns = node("section", "evidence-section");
    turns.append(sectionHeading(t("turns"), String(treeNode.turns?.length || 0)));
    const list = node("div", "timeline");
    for (const turn of treeNode.turns || []) {
      const row = node("div", "timeline-row");
      row.append(
        node("span", "timeline-time", formatClock(turn.startTs)),
        node("span", "timeline-kind", `T${turn.turnIndex}`),
        node("span", "timeline-summary", `${turn.nodes.length} nodes · ${turn.stopReason || ""}`),
      );
      list.append(row);
    }
    turns.append(list);
    view.append(turns);
    return view;
  }

  if (treeNode.kind === "turn") {
    const section = node("section", "evidence-section");
    section.append(sectionHeading(t("turn"), `T${treeNode.turnIndex}`));
    section.append(kvTable([
      [t("status"), treeNode.stopReason],
      [t("started"), formatTimestamp(treeNode.startTs)],
      [t("completed"), formatTimestamp(treeNode.endTs)],
      [t("tokens"), formatTokens(treeNode.usage?.totalTokens)],
      [t("cost"), formatCost(treeNode.usage?.costTotal)],
    ]));
    view.append(section);
    const nodes = node("section", "evidence-section");
    nodes.append(sectionHeading(t("nodes"), String(treeNode.nodes?.length || 0)));
    const list = node("div", "timeline");
    for (const child of treeNode.nodes || []) {
      const row = node("div", "timeline-row");
      let summary = child.kind;
      if (child.kind === "generation") summary = modelFor(child.exchange);
      if (child.kind === "tool") summary = `${child.toolName} ${child.isError ? "error" : "ok"}`;
      if (child.kind === "message") summary = `${child.role}: ${truncate(child.message?.text || "", 80)}`;
      row.append(
        node("span", "timeline-time", formatClock(child.ts)),
        node("span", "timeline-kind", child.kind),
        node("span", "timeline-summary", summary),
      );
      list.append(row);
    }
    nodes.append(list);
    view.append(nodes);
    if (treeNode.usage) {
      view.append(codeSection(t("usage"), "turn", prettyJson(treeNode.usage), null));
    }
    return view;
  }

  if (treeNode.kind === "tool") {
    const section = node("section", "evidence-section");
    section.append(sectionHeading(t("toolCalls"), treeNode.toolName));
    section.append(kvTable([
      [t("callId"), treeNode.toolCallId],
      [t("status"), treeNode.isError ? t("failed") : t("success")],
    ]));
    view.append(section);
    view.append(codeSection(t("arguments"), "", prettyJson(treeNode.args ?? {}), "tool-args"));
    const resultText =
      treeNode.result?.contentText
      ?? treeNode.result?.resultText
      ?? prettyJson(treeNode.result?.content ?? treeNode.result ?? t("noResult"));
    view.append(codeSection(t("result"), treeNode.isError ? t("failed") : "", resultText, "tool-result"));
    return view;
  }

  if (treeNode.kind === "message") {
    const msg = treeNode.message || {};
    view.append(
      messageRow({
        role: msg.role || treeNode.role,
        text: msg.text || "",
        media: [],
        toolCalls: (msg.toolCalls || []).map((c) => ({
          callId: c.id,
          name: c.name,
          arguments: prettyJson(c.arguments),
        })),
        toolResults: [],
      }),
    );
    if (msg.thinking) {
      const details = node("details", "reasoning-block");
      details.open = true;
      details.append(node("summary", "", t("reasoning")), node("pre", "", msg.thinking));
      view.append(details);
    }
    if (msg.usage || treeNode.usage) {
      view.append(codeSection(t("usage"), "", prettyJson(msg.usage || treeNode.usage), null));
    }
    view.append(codeSection(t("rawEvidence"), treeNode.id, prettyJson(msg), "raw"));
    return view;
  }

  return emptyState(t("selectRequest"), t("noSelectionHint"));
}

export function renderInspector() {
  renderInspectorHeader();
  const treeNode = selectedTreeNode();
  const showWireTabs = !treeNode || treeNode.kind === "generation";
  elements.inspectorTabs.hidden = !showWireTabs;
  renderTabs();
  if (state.loadingHistory) {
    replace(elements.inspectorPanel, skeleton(8));
    return;
  }
  if (treeNode && treeNode.kind !== "generation") {
    replace(elements.inspectorPanel, renderNodeContent(treeNode));
    return;
  }
  const exchange = selectedExchange();
  if (!exchange) {
    replace(elements.inspectorPanel, emptyState(t("selectRequest"), t("noSelectionHint")));
    return;
  }
  const views = {
    flow: renderFlow,
    payload: renderPayload,
    headers: renderRequestHeaders,
    responseMeta: renderResponseMeta,
    response: renderResponse,
    timeline: renderTimeline,
    raw: renderRaw,
  };
  replace(elements.inspectorPanel, (views[state.activeTab] || renderFlow)(exchange));
}

export function patchLiveInspector(exchange) {
  if (!exchange || exchange.id !== state.selectedExchangeId || state.activeTab !== "flow") return;
  const output = document.getElementById("liveStreamOutput");
  if (!output) return;
  output.textContent = exchange.stream?.text || t("awaitingOutput");
  output.classList.toggle("is-empty", !exchange.stream?.text);
  output.classList.toggle("is-live", exchangeState(exchange) === "live");
  const meta = document.getElementById("liveStreamMeta");
  if (meta) meta.textContent = streamMeta(exchange);
  const oldRail = document.getElementById("liveStageRail");
  if (oldRail) oldRail.replaceWith(renderStages(exchange));
  const reasoning = document.querySelector("#liveReasoning pre");
  if (exchange.stream?.reasoning && !reasoning) {
    renderInspector();
    return;
  }
  if (reasoning) reasoning.textContent = exchange.stream?.reasoning || "";

  const flowState = document.getElementById("liveFlowState");
  if (flowState) {
    const value = exchangeState(exchange);
    flowState.classList.toggle("status-live", value === "live");
    flowState.classList.toggle("status-error", value === "error");
    const label = flowState.querySelector("span:last-child");
    if (label) label.textContent = stateLabel(value);
  }

  const calls = toolCallsForExchange(exchange);
  const existing = [...document.querySelectorAll("[data-tool-key]")];
  if (calls.length !== existing.length) {
    renderInspector();
    return;
  }
  const byKey = new Map(existing.map((element) => [element.dataset.toolKey, element]));
  for (const call of calls) {
    const details = byKey.get(call.key);
    const argumentsBlock = details?.querySelector("[data-tool-arguments]");
    if (argumentsBlock) argumentsBlock.textContent = prettyJson(call.arguments || "{}");
    const toolState = details?.querySelector(".tool-state");
    if (toolState) {
      toolState.className = `tool-state ${call.state === "streaming" ? "live" : ""}`;
      toolState.textContent = call.state === "streaming" ? t("streaming") : t("waiting");
    }
  }
  renderInspectorHeader();
}

export function renderAll() {
  renderStatic();
  renderSessions();
  renderSessionContext();
  renderRequests();
  renderInspector();
  elements.app.setAttribute("aria-busy", String(state.loadingSessions || state.loadingHistory));
}

let toastTimer;
export function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 2200);
}
