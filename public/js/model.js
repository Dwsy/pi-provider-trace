import { msBetween } from "./format.js";

export const state = {
  sessions: [],
  batchMode: false,
  selectedSessionKeys: new Set(),
  activeSessionKey: null,
  selectedSessionKey: null,
  selectedExchangeId: null,
  /** @type {{ kind: 'prompt'|'turn'|'generation'|'tool'|'message'|'input', id: string } | null} */
  selectedNode: null,
  /** list mode: turns (session tree) | requests (HTTP ledger) */
  listMode: "requests",
  exchanges: new Map(),
  piEvents: [],
  metrics: null,
  activeTab: "flow",
  query: "",
  providerFilter: "",
  statusFilter: "",
  follow: true,
  connection: "connecting",
  loadingSessions: true,
  loadingHistory: false,
  error: null,
  collapsedPrompts: new Set(),
  collapsedTurns: new Set(),
};

export function resetSessionTrace() {
  state.exchanges.clear();
  state.piEvents.length = 0;
  state.metrics = null;
  state.selectedExchangeId = null;
  state.selectedNode = null;
  state.error = null;
  state.collapsedPrompts.clear();
  state.collapsedTurns.clear();
}

function ensureExchange(id) {
  let exchange = state.exchanges.get(id);
  if (!exchange) {
    exchange = {
      id,
      request: null,
      response: null,
      stream: null,
      streamDurable: false,
      usage: null,
      errors: [],
      lastTs: null,
      sessionKey: null,
      searchSignature: null,
      searchValue: "",
    };
    state.exchanges.set(id, exchange);
  }
  return exchange;
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function mergeUsage(current, incoming) {
  if (!current) return { ...incoming };
  const fields = [
    "input", "output", "cacheRead", "cacheWrite", "totalTokens",
    "costTotal", "costInput", "costOutput", "costCacheRead", "costCacheWrite",
  ];
  const merged = { ...current, ...incoming };
  for (const field of fields) merged[field] = Math.max(number(current[field]), number(incoming[field]));
  const denominator = merged.input + merged.cacheRead;
  merged.cacheHitRate = denominator > 0 ? merged.cacheRead / denominator : 0;
  return merged;
}

function latestExchange() {
  return sortedExchanges()[0] ?? null;
}

export function ingestRecord(record) {
  if (!record || !record.kind || !record.id) return { changed: false };
  if (state.selectedSessionKey && record.sessionKey && record.sessionKey !== state.selectedSessionKey) {
    return { changed: false };
  }
  if (record.kind === "pi_event") {
    state.piEvents.push(record);
    if (state.piEvents.length > 3000) state.piEvents.splice(0, state.piEvents.length - 2500);
    return { changed: true, type: "event" };
  }
  if (record.kind === "observation" || record.id === "session") return { changed: false };

  let exchange = state.exchanges.get(record.id);
  if (record.kind === "llm_usage" && !exchange) exchange = latestExchange();
  exchange ??= ensureExchange(record.id);
  exchange.lastTs = record.ts || exchange.lastTs;
  exchange.sessionKey = record.sessionKey || exchange.sessionKey;

  if (record.kind === "request") exchange.request = record;
  if (record.kind === "response_meta") exchange.response = record;
  if (record.kind === "stream_update" && record.stream) {
    const previous = exchange.stream || { text: "", reasoning: "", toolCalls: [] };
    const previousCount = number(previous.eventCount);
    const incomingCount = number(record.stream.eventCount);
    if (incomingCount < previousCount || (record.streamDelta && incomingCount <= previousCount)) {
      return { changed: false, type: record.kind, exchange };
    }
    exchange.stream = record.streamDelta
      ? {
          ...previous,
          ...record.stream,
          text: (previous.text || "") + (record.streamDelta.text || ""),
          reasoning: (previous.reasoning || "") + (record.streamDelta.reasoning || ""),
        }
      : record.stream;
    exchange.streamDurable = false;
  }
  if (record.kind === "stream_result" && record.stream) {
    exchange.stream = record.stream;
    exchange.streamDurable = true;
  }
  if (record.kind === "llm_usage" && record.usage) exchange.usage = mergeUsage(exchange.usage, record.usage);
  if (record.kind === "error") exchange.errors.push(record);

  return { changed: true, type: record.kind, exchange };
}

export function selectedSession() {
  return state.sessions.find((session) => session.key === state.selectedSessionKey) ?? null;
}

export function selectedExchange() {
  return state.selectedExchangeId ? state.exchanges.get(state.selectedExchangeId) ?? null : null;
}

export function sortedExchanges() {
  return [...state.exchanges.values()]
    .filter((exchange) => exchange.request)
    .sort((a, b) => (b.request?.ts || b.lastTs || "").localeCompare(a.request?.ts || a.lastTs || ""));
}

export function parseBody(exchange) {
  const source = exchange?.request?.bodyPreview;
  if (!source) return null;
  try { return JSON.parse(source); } catch { return source; }
}

export function providerFor(exchange) {
  const fromUsage = exchange?.usage?.provider;
  if (fromUsage) return normalizeProvider(fromUsage);
  const url = String(exchange?.request?.url || "").toLowerCase();
  if (url.includes("anthropic")) return "anthropic";
  if (url.includes("openai") || url.includes("/v1/responses")) return "openai";
  if (url.includes("generativelanguage") || url.includes("googleapis")) return "google";
  if (url.includes("bedrock") || url.includes("amazonaws")) return "bedrock";
  if (url.includes("azure")) return "azure";
  if (url.includes("deepseek")) return "deepseek";
  if (url.includes("openrouter")) return "openrouter";
  return "provider";
}

function normalizeProvider(value) {
  const provider = String(value).toLowerCase();
  if (provider.includes("google")) return "google";
  if (provider.includes("openai")) return "openai";
  return provider;
}

export function modelFor(exchange) {
  if (exchange?.usage?.model) return exchange.usage.model;
  const body = parseBody(exchange);
  if (!body || typeof body !== "object") return "unknown model";
  return body.model || body.modelId || body.model_id || body.deployment || "unknown model";
}

export function exchangeState(exchange) {
  if (exchange?.stream?.state === "streaming") return "live";
  if (exchange?.stream?.state === "error" || exchange?.errors?.length || number(exchange?.response?.status) >= 400) return "error";
  if (exchange?.stream?.state === "complete") return "ok";
  return "pending";
}

export function exchangeDuration(exchange) {
  const start = exchange?.request?.ts;
  const end = exchange?.stream?.lastEventTs || exchange?.lastTs || exchange?.response?.ts;
  return msBetween(start, end);
}

export function exchangeTtft(exchange) {
  return msBetween(exchange?.request?.ts, exchange?.stream?.firstEventTs);
}

function searchText(exchange) {
  const body = exchange?.request?.bodyPreview || "";
  const stream = exchange?.stream?.text || "";
  const tools = (exchange?.stream?.toolCalls || []).map((call) => `${call.name || ""} ${call.arguments || ""}`).join(" ");
  const signature = `${body.length}:${stream.length}:${tools.length}:${exchange?.usage?.model || ""}`;
  if (exchange.searchSignature === signature) return exchange.searchValue;
  exchange.searchSignature = signature;
  exchange.searchValue = `${exchange?.id || ""} ${exchange?.request?.url || ""} ${providerFor(exchange)} ${modelFor(exchange)} ${body} ${stream} ${tools}`.toLowerCase();
  return exchange.searchValue;
}

export function visibleExchanges() {
  const query = state.query.trim().toLowerCase();
  return sortedExchanges().filter((exchange) => {
    if (state.providerFilter && providerFor(exchange) !== state.providerFilter) return false;
    if (state.statusFilter && exchangeState(exchange) !== state.statusFilter) return false;
    return !query || searchText(exchange).includes(query);
  });
}

export function visibleSessions() {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.sessions;
  return state.sessions.filter((session) => `${session.label || ""} ${session.key || ""}`.toLowerCase().includes(query));
}

export function availableProviders() {
  return [...new Set(sortedExchanges().map(providerFor))].sort();
}

const CONTENT_KEYS = new Set([
  "messages", "input", "contents", "system", "instructions", "tools", "functions",
]);

const NESTED_PARAMETER_KEYS = new Set([
  "generationConfig", "generation_config", "inferenceConfig", "inference_config", "textGenerationConfig",
]);

const PARAMETER_ORDER = [
  "model", "modelId", "model_id", "temperature", "top_p", "topP", "top_k", "topK",
  "max_tokens", "max_output_tokens", "maxOutputTokens", "min_tokens", "stream", "stop", "seed",
  "frequency_penalty", "presence_penalty", "reasoning_effort", "reasoning", "verbosity",
  "tool_choice", "parallel_tool_calls", "response_format", "modalities", "n",
];

function parameterRank(key) {
  const leaf = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
  const rank = PARAMETER_ORDER.indexOf(leaf);
  return rank < 0 ? PARAMETER_ORDER.length : rank;
}

/** Provider-neutral top-level generation settings, excluding prompt content and tool definitions. */
export function requestParametersForExchange(exchange) {
  const body = parseBody(exchange);
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const parameters = [];
  for (const [key, value] of Object.entries(body)) {
    if (CONTENT_KEYS.has(key) || value === undefined) continue;
    if (NESTED_PARAMETER_KEYS.has(key) && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        parameters.push({ key: `${key}.${nestedKey}`, value: nestedValue });
      }
      continue;
    }
    parameters.push({ key, value });
  }
  return parameters.sort((left, right) => {
    const rank = parameterRank(left.key) - parameterRank(right.key);
    return rank || left.key.localeCompare(right.key);
  });
}

function normalizeToolDefinition(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const fn = raw.function && typeof raw.function === "object" ? raw.function : raw;
  const type = raw.type || (raw.function ? "function" : "tool");
  return {
    key: String(fn.name || raw.name || raw.type || `tool-${index}`),
    name: String(fn.name || raw.name || raw.type || `tool-${index + 1}`),
    type: String(type),
    description: String(fn.description || raw.description || ""),
    parameters: fn.parameters ?? fn.input_schema ?? fn.inputSchema ?? raw.parameters ?? raw.input_schema ?? raw,
  };
}

/** OpenAI, Anthropic, Google, and built-in tool declarations normalized into one list. */
export function toolDefinitionsForExchange(exchange) {
  const body = parseBody(exchange);
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const definitions = [];
  const rawTools = [
    ...(Array.isArray(body.tools) ? body.tools : []),
    ...(Array.isArray(body.functions) ? body.functions.map((fn) => ({ type: "function", function: fn })) : []),
  ];
  for (const raw of rawTools) {
    const declarations = raw?.functionDeclarations ?? raw?.function_declarations;
    if (Array.isArray(declarations)) {
      for (const declaration of declarations) {
        const normalized = normalizeToolDefinition(declaration, definitions.length);
        if (normalized) definitions.push(normalized);
      }
      continue;
    }
    const normalized = normalizeToolDefinition(raw, definitions.length);
    if (normalized) definitions.push(normalized);
  }
  return definitions;
}

function contentParts(content) {
  if (content == null) return { text: "", media: [], toolCalls: [], toolResults: [] };
  if (typeof content === "string") return { text: content, media: [], toolCalls: [], toolResults: [] };
  if (!Array.isArray(content)) return { text: valueText(content), media: [], toolCalls: [], toolResults: [] };
  const text = [];
  const media = [];
  const toolCalls = [];
  const toolResults = [];
  for (const block of content) {
    if (typeof block === "string") {
      text.push(block);
      continue;
    }
    if (!block || typeof block !== "object") continue;
    const type = block.type || "";
    if (["text", "input_text", "output_text"].includes(type) && typeof block.text === "string") text.push(block.text);
    else if (type === "thinking" && typeof block.thinking === "string") text.push(block.thinking);
    else if (type === "tool_result") toolResults.push({ callId: block.tool_use_id || "", output: valueText(block.content), isError: Boolean(block.is_error) });
    else if (type === "tool_use") toolCalls.push({ callId: block.id || "", name: block.name || "unknown", arguments: valueText(block.input) });
    else if (type === "function_call") toolCalls.push({ callId: block.call_id || block.id || "", name: block.name || "unknown", arguments: valueText(block.arguments) });
    else if (type === "function_call_output") toolResults.push({ callId: block.call_id || "", output: valueText(block.output), isError: false });
    if (type.includes("image") || block.image_url || block.source || block.inline_data || block.inlineData) {
      const source = block.image_url?.url || block.image_url || block.source?.url || block.source?.media_type
        || block.inline_data?.mime_type || block.inlineData?.mimeType || type;
      media.push(String(source));
    }
  }
  return { text: text.filter(Boolean).join("\n"), media, toolCalls, toolResults };
}

function valueText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function normalizeMessage(raw, fallbackRole = "message") {
  if (typeof raw === "string") return { role: fallbackRole, text: raw, media: [], toolCalls: [], toolResults: [] };
  if (!raw || typeof raw !== "object") return null;
  const parts = contentParts(raw.content ?? raw.parts ?? raw.text ?? raw.output ?? raw);
  for (const call of Array.isArray(raw.tool_calls) ? raw.tool_calls : []) {
    const fn = call?.function || call;
    parts.toolCalls.push({
      callId: call?.id || call?.call_id || "",
      name: fn?.name || "unknown",
      arguments: valueText(fn?.arguments),
    });
  }
  if (raw.function_call) {
    parts.toolCalls.push({
      callId: raw.call_id || "",
      name: raw.function_call.name || "unknown",
      arguments: valueText(raw.function_call.arguments),
    });
  }
  if (raw.type === "function_call") {
    parts.toolCalls.push({ callId: raw.call_id || raw.id || "", name: raw.name || "unknown", arguments: valueText(raw.arguments) });
    parts.text = "";
  }
  if (raw.type === "function_call_output") {
    parts.toolResults.push({ callId: raw.call_id || "", output: valueText(raw.output), isError: false });
    parts.text = "";
  }
  if (raw.role === "tool") {
    parts.toolResults.push({ callId: raw.tool_call_id || raw.call_id || "", output: valueText(raw.content), isError: false });
    parts.text = "";
  }
  return {
    role: raw.role || raw.author || (raw.type === "function_call" ? "assistant" : raw.type === "function_call_output" ? "tool" : fallbackRole),
    text: parts.text,
    media: parts.media,
    toolCalls: parts.toolCalls,
    toolResults: parts.toolResults,
  };
}

export function messagesForExchange(exchange) {
  const body = parseBody(exchange);
  if (!body || typeof body !== "object") return [];
  const messages = [];
  if (body.instructions) messages.push(normalizeMessage(body.instructions, "system"));
  if (body.system) messages.push(normalizeMessage(body.system, "system"));
  for (const item of Array.isArray(body.messages) ? body.messages : []) messages.push(normalizeMessage(item));
  if (typeof body.input === "string") messages.push(normalizeMessage(body.input, "user"));
  for (const item of Array.isArray(body.input) ? body.input : []) messages.push(normalizeMessage(item));
  for (const item of Array.isArray(body.contents) ? body.contents : []) {
    messages.push(normalizeMessage({ role: item?.role, content: item?.parts }));
  }
  return messages.filter((message) => message && (
    message.text || message.media.length || message.toolCalls.length || message.toolResults.length
  ));
}

function extractToolResults(source) {
  const results = [];
  if (!source || typeof source !== "object") return results;
  const add = (callId, output, isError = false) => {
    if (callId) results.push({ callId: String(callId), output: valueText(output), isError: Boolean(isError) });
  };
  const visitContent = (content) => {
    for (const block of Array.isArray(content) ? content : []) {
      if (block?.type === "tool_result") add(block.tool_use_id, block.content, block.is_error);
    }
  };
  for (const message of Array.isArray(source.messages) ? source.messages : []) {
    if (message?.role === "tool") add(message.tool_call_id, message.content);
    visitContent(message?.content);
  }
  for (const item of Array.isArray(source.input) ? source.input : []) {
    if (item?.type === "function_call_output") add(item.call_id, item.output);
    if (item?.role === "tool") add(item.tool_call_id, item.content);
    visitContent(item?.content);
  }
  return results;
}

export function toolCallsForExchange(exchange) {
  const calls = exchange?.stream?.toolCalls || [];
  if (!calls.length) return [];
  const requests = sortedExchanges().slice().reverse();
  const selectedTime = exchange?.request?.ts || "";
  const results = new Map();
  for (const later of requests) {
    if ((later.request?.ts || "") <= selectedTime) continue;
    const body = parseBody(later);
    for (const result of extractToolResults(body)) if (!results.has(result.callId)) results.set(result.callId, result);
  }
  return calls.map((call) => ({ ...call, result: call.callId ? results.get(call.callId) ?? null : null }));
}

export function linkedPiEvents(exchange) {
  const requests = sortedExchanges().slice().reverse();
  const index = requests.findIndex((item) => item.id === exchange?.id);
  if (index < 0) return [];
  const start = index > 0 ? requests[index - 1].request?.ts || "" : "";
  const end = index + 1 < requests.length ? requests[index + 1].request?.ts || "\uffff" : "\uffff";
  return state.piEvents.filter((event) => (event.ts || "") > start && (event.ts || "") < end);
}

export function timelineForExchange(exchange) {
  const records = [...linkedPiEvents(exchange)];
  if (exchange?.request) records.push(exchange.request);
  if (exchange?.response) records.push(exchange.response);
  if (exchange?.stream) {
    records.push({
      ts: exchange.stream.lastEventTs || exchange.lastTs,
      kind: exchange.streamDurable ? "stream_result" : "stream_update",
      id: exchange.id,
      stream: exchange.stream,
    });
  }
  if (exchange?.usage) records.push({ ts: exchange.lastTs, kind: "llm_usage", id: exchange.id, usage: exchange.usage });
  records.push(...(exchange?.errors || []));
  return records.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
}

export function sessionStats() {
  let tokens = 0;
  let cost = 0;
  let errors = 0;
  const exchanges = sortedExchanges();
  for (const exchange of exchanges) {
    tokens += number(exchange.usage?.totalTokens);
    cost += number(exchange.usage?.costTotal);
    if (exchangeState(exchange) === "error") errors += 1;
  }
  return { requests: exchanges.length, tokens, cost, errors };
}

export function rawEvidence(exchange) {
  return {
    request: exchange?.request,
    response: exchange?.response,
    stream: exchange?.stream,
    streamDurable: exchange?.streamDurable,
    usage: exchange?.usage,
    errors: exchange?.errors,
    piEvents: linkedPiEvents(exchange),
  };
}

function eventTurnIndex(event) {
  if (typeof event?.turnIndex === "number") return event.turnIndex;
  if (typeof event?.detail?.turnIndex === "number") return event.detail.turnIndex;
  return null;
}

function toolKey(event) {
  const d = event?.detail || {};
  return String(d.toolCallId || event?.id || "");
}

/**
 * Build Langfuse-style hierarchy: prompt → turn → (generation | tool | message).
 * Correlates HTTP exchanges into the active turn by timestamp window.
 */
export function buildSessionTree() {
  const events = [...state.piEvents].sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
  const exchanges = sortedExchanges().slice().reverse(); // chronological
  const prompts = [];
  let prompt = null;
  let turn = null;
  let exchangeCursor = 0;

  const openPrompt = (ts, inputEvent) => {
    prompt = {
      id: `prompt-${ts || prompts.length}`,
      kind: "prompt",
      startTs: ts || null,
      endTs: null,
      input: inputEvent?.detail?.text || inputEvent?.summary || "",
      inputSource: inputEvent?.detail?.source || null,
      inputEvent: inputEvent || null,
      turns: [],
      orphanNodes: [],
    };
    prompts.push(prompt);
    turn = null;
  };

  const openTurn = (ts, turnIndex) => {
    if (!prompt) openPrompt(ts, null);
    turn = {
      id: `turn-${prompt.id}-${turnIndex ?? prompt.turns.length}`,
      kind: "turn",
      turnIndex: turnIndex ?? prompt.turns.length,
      startTs: ts || null,
      endTs: null,
      stopReason: null,
      usage: null,
      nodes: [],
    };
    prompt.turns.push(turn);
  };

  const attachPendingExchanges = (untilTs) => {
    if (!turn) return;
    while (exchangeCursor < exchanges.length) {
      const ex = exchanges[exchangeCursor];
      const ts = ex.request?.ts || ex.lastTs || "";
      if (untilTs && ts > untilTs) break;
      if (turn.startTs && ts && ts < turn.startTs) {
        exchangeCursor += 1;
        continue;
      }
      turn.nodes.push({
        id: `gen-${ex.id}`,
        kind: "generation",
        exchangeId: ex.id,
        ts,
        exchange: ex,
      });
      exchangeCursor += 1;
    }
  };

  const tools = new Map(); // toolCallId → node

  for (const event of events) {
    const name = event.eventName;
    const ts = event.ts || "";

    if (name === "input" || name === "before_agent_start") {
      if (name === "input") openPrompt(ts, event);
      else if (!prompt || prompt.endTs) openPrompt(ts, null);
      continue;
    }

    if (name === "agent_start") {
      if (!prompt) openPrompt(ts, null);
      continue;
    }

    if (name === "turn_start") {
      attachPendingExchanges(ts);
      openTurn(ts, eventTurnIndex(event) ?? event.detail?.turnIndex);
      continue;
    }

    if (name === "turn_end") {
      attachPendingExchanges(ts);
      if (turn) {
        turn.endTs = ts;
        turn.stopReason = event.detail?.stopReason || event.detail?.message?.stopReason || null;
        turn.usage = event.detail?.usage || null;
        // attach tool results from turn_end payload if tools incomplete
        for (const tr of event.detail?.toolResults || []) {
          const key = String(tr.toolCallId || "");
          if (!key) continue;
          let node = tools.get(key);
          if (!node) {
            node = {
              id: `tool-${key}`,
              kind: "tool",
              toolCallId: key,
              toolName: tr.toolName || "?",
              ts,
              args: null,
              result: tr,
              isError: Boolean(tr.isError),
              events: [],
            };
            tools.set(key, node);
            turn.nodes.push(node);
          } else if (!node.result) {
            node.result = tr;
            node.isError = Boolean(tr.isError);
          }
        }
        turn = null;
      }
      continue;
    }

    if (name === "agent_end") {
      attachPendingExchanges(ts);
      if (prompt) prompt.endTs = ts;
      turn = null;
      continue;
    }

    if (name === "tool_execution_start" || name === "tool_call") {
      if (!turn) openTurn(ts, eventTurnIndex(event));
      attachPendingExchanges(ts);
      const key = toolKey(event) || `anon-${event.id}`;
      let node = tools.get(key);
      if (!node) {
        node = {
          id: `tool-${key}`,
          kind: "tool",
          toolCallId: key,
          toolName: event.detail?.toolName || "?",
          ts,
          args: event.detail?.args ?? event.detail?.input ?? null,
          result: null,
          isError: false,
          events: [event],
          exchangeId: event.exchangeId || null,
        };
        tools.set(key, node);
        turn.nodes.push(node);
      } else {
        node.args = node.args ?? event.detail?.args ?? event.detail?.input ?? null;
        node.toolName = event.detail?.toolName || node.toolName;
        node.events.push(event);
      }
      continue;
    }

    if (name === "tool_result" || name === "tool_execution_end") {
      if (!turn) openTurn(ts, eventTurnIndex(event));
      const key = toolKey(event) || `anon-${event.id}`;
      let node = tools.get(key);
      const resultPayload =
        name === "tool_result"
          ? event.detail
          : {
              toolName: event.detail?.toolName,
              toolCallId: event.detail?.toolCallId,
              isError: event.detail?.isError,
              contentText: event.detail?.resultText,
              content: event.detail?.result,
            };
      if (!node) {
        node = {
          id: `tool-${key}`,
          kind: "tool",
          toolCallId: key,
          toolName: event.detail?.toolName || "?",
          ts,
          args: event.detail?.input ?? event.detail?.args ?? null,
          result: resultPayload,
          isError: Boolean(event.detail?.isError),
          events: [event],
          exchangeId: event.exchangeId || null,
        };
        tools.set(key, node);
        turn.nodes.push(node);
      } else {
        node.result = resultPayload;
        node.isError = Boolean(event.detail?.isError);
        node.events.push(event);
      }
      continue;
    }

    if (name === "message_end" || name === "message_start") {
      if (!turn) continue;
      const msg = event.detail?.message;
      if (!msg) continue;
      // skip pure assistant streaming shells when generation node exists; still keep user/toolResult
      const role = msg.role || "?";
      if (name === "message_start" && role === "assistant") continue;
      turn.nodes.push({
        id: `msg-${event.id}`,
        kind: "message",
        role,
        ts,
        message: msg,
        stopReason: event.detail?.stopReason || msg.stopReason,
        usage: event.detail?.usage || msg.usage,
        event,
        exchangeId: event.exchangeId || null,
      });
      continue;
    }
  }

  // remaining exchanges after last turn window
  if (turn) attachPendingExchanges(null);
  else if (prompt) {
    while (exchangeCursor < exchanges.length) {
      const ex = exchanges[exchangeCursor++];
      prompt.orphanNodes.push({
        id: `gen-${ex.id}`,
        kind: "generation",
        exchangeId: ex.id,
        ts: ex.request?.ts || ex.lastTs,
        exchange: ex,
      });
    }
  } else {
    // no pi structure — synthetic prompt from exchanges only
    if (exchanges.length) {
      openPrompt(exchanges[0].request?.ts || null, null);
      openTurn(exchanges[0].request?.ts || null, 0);
      for (const ex of exchanges) {
        turn.nodes.push({
          id: `gen-${ex.id}`,
          kind: "generation",
          exchangeId: ex.id,
          ts: ex.request?.ts || ex.lastTs,
          exchange: ex,
        });
      }
    }
  }

  return { prompts, events: events.length, exchanges: exchanges.length };
}

export function selectedTreeNode() {
  if (!state.selectedNode) return null;
  const tree = buildSessionTree();
  const { kind, id } = state.selectedNode;
  for (const prompt of tree.prompts) {
    if (kind === "prompt" && prompt.id === id) return prompt;
    if (kind === "input" && prompt.id === id) return { ...prompt, kind: "input" };
    for (const node of prompt.orphanNodes || []) {
      if (node.id === id) return node;
    }
    for (const turn of prompt.turns) {
      if (kind === "turn" && turn.id === id) return turn;
      for (const node of turn.nodes) {
        if (node.id === id) return node;
      }
    }
  }
  return null;
}

export function selectTreeNode(node) {
  if (!node) {
    state.selectedNode = null;
    return;
  }
  state.selectedNode = { kind: node.kind, id: node.id };
  if (node.kind === "generation" && node.exchangeId) {
    state.selectedExchangeId = node.exchangeId;
  } else if (node.exchangeId) {
    state.selectedExchangeId = node.exchangeId;
  } else if (node.kind === "turn") {
    const gen = (node.nodes || []).find((n) => n.kind === "generation");
    if (gen?.exchangeId) state.selectedExchangeId = gen.exchangeId;
  }
}

export function sessionTreeStats(tree = buildSessionTree()) {
  let turns = 0;
  let tools = 0;
  let generations = 0;
  for (const prompt of tree.prompts) {
    turns += prompt.turns.length;
    for (const turn of prompt.turns) {
      for (const node of turn.nodes) {
        if (node.kind === "tool") tools += 1;
        if (node.kind === "generation") generations += 1;
      }
    }
    generations += (prompt.orphanNodes || []).filter((n) => n.kind === "generation").length;
  }
  return { prompts: tree.prompts.length, turns, tools, generations };
}
