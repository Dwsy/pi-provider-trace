import { t, applyStaticText } from "./i18n.js";
import {
  availableProviders,
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
  sessionStats,
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
  elements.sessionTitle.textContent = session?.label || t("requests");
  elements.sessionActions.hidden = !session || state.batchMode;
  if (session) elements.exportSession.href = `/api/download?session=${encodeURIComponent(session.key)}&file=http-sse`;
  const stats = sessionStats();
  replace(
    elements.sessionSummary,
    summaryMetric(stats.requests, t("requestCount")),
    summaryMetric(formatTokens(stats.tokens), t("tokens")),
    summaryMetric(formatCost(stats.cost), t("cost")),
    summaryMetric(stats.errors, t("errors")),
  );
  updateProviderFilter();
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
  const exchange = selectedExchange();
  if (!exchange) {
    const eyebrow = node("p", "eyebrow", "REQUEST EVIDENCE");
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

export function renderInspector() {
  renderInspectorHeader();
  renderTabs();
  if (state.loadingHistory) {
    replace(elements.inspectorPanel, skeleton(8));
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
