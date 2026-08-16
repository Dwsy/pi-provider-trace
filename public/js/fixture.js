/**
 * Sample payloads for `?fixture=1`, used only when the real endpoint fails.
 * Shapes follow docs/overview-api-contract.md exactly, including `null` metrics
 * for empty samples, so the UI is exercised the same way a backend would.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.now();

const WINDOW_MS = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY };

const MODELS = [
  {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    url: "https://api.anthropic.com/v1/messages",
    rates: { input: 3e-6, output: 15e-6, cacheRead: 0.3e-6 },
    ttft: [420, 1400],
    tps: [38, 74],
  },
  {
    provider: "openai",
    model: "gpt-5.2-codex",
    url: "https://api.openai.com/v1/responses",
    rates: { input: 1.25e-6, output: 10e-6, cacheRead: 0.13e-6 },
    ttft: [700, 3200],
    tps: [22, 48],
  },
  {
    provider: "openai",
    model: "gpt-5.2-mini",
    url: "https://api.openai.com/v1/responses",
    rates: { input: 0.25e-6, output: 2e-6, cacheRead: 0.03e-6 },
    ttft: [260, 900],
    tps: [60, 130],
  },
  {
    provider: "google",
    model: "gemini-3-pro",
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:streamGenerateContent",
    rates: { input: 1.25e-6, output: 10e-6, cacheRead: 0.31e-6 },
    ttft: [520, 2100],
    tps: [30, 66],
  },
  {
    // Non-streaming provider: every TTFT and tok/s sample is empty, so every
    // derived metric on this row must render as an em dash rather than 0 ms.
    provider: "deepseek",
    model: "deepseek-v4",
    url: "https://api.deepseek.com/chat/completions",
    rates: { input: 0.27e-6, output: 1.1e-6, cacheRead: 0.07e-6 },
    ttft: null,
    tps: null,
  },
  {
    provider: "unknown",
    model: "unknown",
    url: "http://127.0.0.1:11434/v1/chat/completions",
    rates: { input: 0, output: 0, cacheRead: 0 },
    ttft: [90, 400],
    tps: null,
  },
];

const SESSION_LABELS = [
  "重构 Provider Trace 前端",
  "Overview API contract review",
  "修复流式增量写放大",
  "Gemini 多模态请求排障",
  "Add windowed session list",
  "会话树节点选择回归",
  "Bench cache hit rate",
  "工具调用结果关联",
  "Migrate logger to durable result",
  "成本回归排查",
  "Keyboard navigation audit",
  "深色主题对比度",
  "Fix SSE reconnect storm",
  "指标目录整理",
  "Local model latency probe",
  "批量导出会话",
  "Contract test harness",
  "错误率告警阈值",
  "Refactor pane resizers",
  "国际化文案补齐",
  "Legacy stream row compaction",
  "旧日志迁移演练",
  "Provider icon generation",
  "首屏渲染预算",
];

/** Age of each session's newest record, in hours. The tail sits outside 30d on purpose. */
const SESSION_AGE_HOURS = [
  0.05, 1.5, 6, 20, 36, 52, 74, 96, 120, 143, 190, 240,
  300, 360, 420, 500, 560, 620, 650, 700, 820, 1100, 1500, 1900,
];

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function iso(time) {
  return new Date(time).toISOString();
}

let cached = null;

/** Deterministic exchange ledger shared by every fixture endpoint. */
function catalog() {
  if (cached) return cached;
  const random = mulberry32(20260811);
  const sessions = [];
  const exchanges = [];

  for (const [index, label] of SESSION_LABELS.entries()) {
    const key = `sess-${String(index + 1).padStart(2, "0")}-${label.slice(0, 6).replace(/\s+/g, "-").toLowerCase()}`;
    const end = NOW - SESSION_AGE_HOURS[index] * HOUR;
    const count = index === 0 ? 46 : 4 + Math.floor(random() * (index < 6 ? 58 : 26));
    const primary = MODELS[index % MODELS.length];
    const secondary = MODELS[(index + 2) % MODELS.length];
    const sessionExchanges = [];
    let cursor = end;

    for (let step = 0; step < count; step += 1) {
      const spec = random() < 0.72 ? primary : secondary;
      const input = 2_400 + Math.floor(random() * 34_000);
      const cacheRead = random() < 0.72 ? Math.floor(input * (0.3 + random() * 0.6)) : 0;
      const cacheWrite = cacheRead ? 0 : Math.floor(input * 0.12);
      const output = 60 + Math.floor(random() * 2_600);
      const error = random() < (index === 3 ? 0.14 : 0.035);
      const ttftMs = spec.ttft ? Math.round(spec.ttft[0] + random() * (spec.ttft[1] - spec.ttft[0])) : null;
      const outputTps = spec.tps ? spec.tps[0] + random() * (spec.tps[1] - spec.tps[0]) : null;
      const latencyMs = ttftMs == null
        ? Math.round(900 + random() * 6_000)
        : Math.round(ttftMs + (outputTps ? (output / outputTps) * 1000 : 800 + random() * 4_000));
      const exchange = {
        id: `${key}-ex-${String(step + 1).padStart(3, "0")}`,
        sessionKey: key,
        time: cursor,
        spec,
        input,
        output,
        cacheRead,
        cacheWrite,
        cost: input * spec.rates.input + output * spec.rates.output + cacheRead * spec.rates.cacheRead,
        ttftMs: error ? null : ttftMs,
        latencyMs: error ? null : latencyMs,
        outputTps: error ? null : outputTps,
        error,
        streaming: index === 0 && step === count - 1,
      };
      sessionExchanges.push(exchange);
      exchanges.push(exchange);
      cursor -= 25_000 + Math.floor(random() * 230_000);
    }

    sessionExchanges.reverse(); // chronological
    sessions.push({
      key,
      label,
      lastTs: iso(end),
      records: sessionExchanges.length * 4,
      httpLogBytes: 18_000 + sessionExchanges.length * (7_000 + Math.floor(random() * 12_000)),
      exchanges: sessionExchanges,
    });
  }

  exchanges.sort((left, right) => left.time - right.time);
  cached = { sessions, exchanges };
  return cached;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Nearest-rank percentile on the sorted sample; an empty sample is null, never 0. */
function percentile(values, percent) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil((percent / 100) * sorted.length));
  return sorted[rank - 1];
}

function accumulate(rows) {
  const usage = rows.filter((row) => !row.error);
  const ttft = usage.map((row) => row.ttftMs).filter((value) => value != null);
  const latency = usage.map((row) => row.latencyMs).filter((value) => value != null);
  const tps = usage.map((row) => row.outputTps).filter((value) => value != null);
  const inputTokens = usage.reduce((total, row) => total + row.input, 0);
  const outputTokens = usage.reduce((total, row) => total + row.output, 0);
  const cacheReadTokens = usage.reduce((total, row) => total + row.cacheRead, 0);
  const cacheWriteTokens = usage.reduce((total, row) => total + row.cacheWrite, 0);
  const prompt = inputTokens + cacheReadTokens;
  return {
    generations: usage.length,
    exchanges: rows.length,
    errors: rows.filter((row) => row.error).length,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    totalCost: usage.reduce((total, row) => total + row.cost, 0),
    cacheHitRate: prompt > 0 ? cacheReadTokens / prompt : 0,
    avgTtftMs: mean(ttft),
    p50TtftMs: percentile(ttft, 50),
    p95TtftMs: percentile(ttft, 95),
    avgLatencyMs: mean(latency),
    p95LatencyMs: percentile(latency, 95),
    avgOutputTps: mean(tps),
  };
}

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

function buildTimeline(rows, windowKey, windowStart) {
  const step = windowKey === "24h" ? HOUR : DAY;
  const oldest = rows.length ? rows[0].time : NOW;
  const start = Math.floor((windowStart ?? oldest) / step) * step;
  const buckets = [];
  for (let edge = start; edge <= NOW; edge += step) {
    const slice = rows.filter((row) => row.time >= edge && row.time < edge + step);
    const totals = accumulate(slice);
    buckets.push({
      bucket: iso(edge),
      generations: totals.generations,
      errors: totals.errors,
      totalTokens: totals.totalTokens,
      totalCost: totals.totalCost,
      avgTtftMs: totals.avgTtftMs,
    });
  }
  return buckets;
}

export function overviewFixture(windowKey = "7d", limit = 50) {
  const { sessions, exchanges } = catalog();
  const windowStart = windowKey === "all" ? null : NOW - (WINDOW_MS[windowKey] ?? WINDOW_MS["7d"]);
  const rows = windowStart == null ? exchanges : exchanges.filter((row) => row.time >= windowStart);
  const totals = accumulate(rows);

  const bySession = groupBy(rows, (row) => row.sessionKey);
  const sessionRows = [];
  for (const session of sessions) {
    const owned = bySession.get(session.key);
    if (!owned?.length) continue;
    const stats = accumulate(owned);
    sessionRows.push({
      key: session.key,
      label: session.label,
      lastTs: iso(owned[owned.length - 1].time),
      generations: stats.generations,
      errors: stats.errors,
      totalTokens: stats.totalTokens,
      totalCost: stats.totalCost,
      avgTtftMs: stats.avgTtftMs,
      avgLatencyMs: stats.avgLatencyMs,
      models: [...new Set(owned.map((row) => `${row.spec.provider}/${row.spec.model}`))],
    });
  }
  sessionRows.sort((left, right) => right.lastTs.localeCompare(left.lastTs));

  const models = [...groupBy(rows, (row) => `${row.spec.provider}/${row.spec.model}`)].map(([key, owned]) => {
    const stats = accumulate(owned);
    return {
      key,
      provider: owned[0].spec.provider,
      model: owned[0].spec.model,
      generations: stats.generations,
      errors: stats.errors,
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      cacheReadTokens: stats.cacheReadTokens,
      totalTokens: stats.totalTokens,
      totalCost: stats.totalCost,
      avgTtftMs: stats.avgTtftMs,
      p95TtftMs: stats.p95TtftMs,
      avgOutputTps: stats.avgOutputTps,
      sessions: new Set(owned.map((row) => row.sessionKey)).size,
    };
  });
  models.sort((left, right) => right.totalCost - left.totalCost || right.totalTokens - left.totalTokens);

  const providers = [...groupBy(rows, (row) => row.spec.provider)].map(([provider, owned]) => {
    const stats = accumulate(owned);
    return {
      provider,
      generations: stats.generations,
      errors: stats.errors,
      totalTokens: stats.totalTokens,
      totalCost: stats.totalCost,
      avgTtftMs: stats.avgTtftMs,
      sessions: new Set(owned.map((row) => row.sessionKey)).size,
      models: new Set(owned.map((row) => row.spec.model)).size,
    };
  });
  providers.sort((left, right) => right.totalCost - left.totalCost || right.totalTokens - left.totalTokens);

  return {
    generatedAt: iso(NOW),
    window: windowKey,
    windowStart: windowStart == null ? null : iso(windowStart),
    scanned: {
      sessions: sessions.length,
      included: sessionRows.length,
      bytes: sessions.reduce((total, session) => total + session.httpLogBytes, 0),
      truncated: windowKey === "all",
      durationMs: 38 + sessionRows.length * 3,
    },
    totals,
    sessions: sessionRows.slice(0, limit),
    models,
    providers,
    timeline: buildTimeline(rows, windowKey, windowStart),
  };
}

export function sessionsFixture() {
  const { sessions } = catalog();
  return {
    activeSessionKey: sessions[0].key,
    sessions: sessions
      .map(({ key, label, lastTs, records, httpLogBytes }) => ({ key, label, lastTs, records, httpLogBytes }))
      .sort((left, right) => right.lastTs.localeCompare(left.lastTs)),
  };
}

export function statusFixture() {
  const { sessions } = catalog();
  return { enabled: true, activeSession: { key: sessions[0].key, label: sessions[0].label } };
}

function requestBody(exchange, turnIndex) {
  return JSON.stringify({
    model: exchange.spec.model,
    max_tokens: 4096,
    temperature: 0.2,
    stream: true,
    tool_choice: "auto",
    messages: [
      { role: "system", content: "You are inspecting a local developer tool." },
      { role: "user", content: `Turn ${turnIndex}: keep reducing the trace payload without losing evidence.` },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "read",
          description: "Read a range of lines from a workspace file.",
          parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        },
      },
    ],
  });
}

export function historyFixture(sessionKey) {
  const { sessions } = catalog();
  const session = sessions.find((item) => item.key === sessionKey) ?? sessions[0];
  const records = [];
  let turnIndex = 0;

  for (const [index, exchange] of session.exchanges.entries()) {
    const ts = exchange.time;
    if (index % 3 === 0) {
      records.push({
        ts: iso(ts - 1_200),
        sessionKey: session.key,
        kind: "pi_event",
        id: `${exchange.id}-input`,
        eventName: "input",
        summary: "input",
        detail: { source: "interactive", text: `${session.label} · 第 ${index / 3 + 1} 次提问：继续排查证据链。` },
      });
    }
    records.push({
      ts: iso(ts - 800),
      sessionKey: session.key,
      kind: "pi_event",
      id: `${exchange.id}-turn-start`,
      eventName: "turn_start",
      turnIndex,
      detail: { turnIndex },
    });
    records.push({
      ts: iso(ts),
      sessionKey: session.key,
      kind: "request",
      id: exchange.id,
      method: "POST",
      url: exchange.spec.url,
      headers: { "content-type": "application/json", authorization: "Bearer ****" },
      bodyPreview: requestBody(exchange, turnIndex),
    });
    records.push({
      ts: iso(ts + 120),
      sessionKey: session.key,
      kind: "response_meta",
      id: exchange.id,
      url: exchange.spec.url,
      status: exchange.error ? 429 : 200,
      headers: { "content-type": "text/event-stream", "request-id": `req_${exchange.id.slice(-6)}` },
    });

    if (exchange.error) {
      records.push({
        ts: iso(ts + 400),
        sessionKey: session.key,
        kind: "error",
        id: exchange.id,
        message: "429 rate_limit_error: retry after 12s",
      });
    } else {
      const last = ts + (exchange.latencyMs ?? 1_500);
      records.push({
        ts: iso(last),
        sessionKey: session.key,
        kind: exchange.streaming ? "stream_update" : "stream_result",
        id: exchange.id,
        url: exchange.spec.url,
        stream: {
          state: exchange.streaming ? "streaming" : "complete",
          text: `Reduced the ${exchange.spec.model} exchange to one durable record; ${exchange.output} output tokens observed.`,
          reasoning: index % 4 === 0 ? "Keep transient transport state outside persistence." : "",
          toolCalls: index % 2 === 0
            ? [{ key: `${exchange.id}:1`, callId: `call_${index}`, name: "read", arguments: '{"path":"src/logger.ts"}', state: "complete" }]
            : [],
          eventCount: 18 + (index % 40),
          byteCount: 6_200 + index * 137,
          firstEventTs: exchange.ttftMs == null ? undefined : iso(ts + exchange.ttftMs),
          lastEventTs: iso(last),
          finishReason: index % 2 === 0 ? "tool_use" : "end_turn",
        },
      });
      records.push({
        ts: iso(last + 40),
        sessionKey: session.key,
        kind: "llm_usage",
        id: exchange.id,
        summary: "usage",
        usage: {
          provider: exchange.spec.provider,
          model: exchange.spec.model,
          input: exchange.input,
          output: exchange.output,
          cacheRead: exchange.cacheRead,
          cacheWrite: exchange.cacheWrite,
          totalTokens: exchange.input + exchange.output + exchange.cacheRead + exchange.cacheWrite,
          costTotal: exchange.cost,
        },
      });
      if (index % 2 === 0) {
        records.push({
          ts: iso(last + 80),
          sessionKey: session.key,
          kind: "pi_event",
          id: `${exchange.id}-tool`,
          eventName: "tool_execution_start",
          turnIndex,
          detail: { toolName: "read", toolCallId: `call_${index}`, args: { path: "src/logger.ts" } },
        });
        records.push({
          ts: iso(last + 260),
          sessionKey: session.key,
          kind: "pi_event",
          id: `${exchange.id}-tool-result`,
          eventName: "tool_result",
          turnIndex,
          detail: {
            toolName: "read",
            toolCallId: `call_${index}`,
            isError: index % 14 === 0,
            input: { path: "src/logger.ts" },
            contentText: "export function writeTrace(record) {\n  appendFileSync(target, `${JSON.stringify(record)}\\n`);\n}",
          },
        });
      }
      records.push({
        ts: iso(last + 400),
        sessionKey: session.key,
        kind: "pi_event",
        id: `${exchange.id}-turn-end`,
        eventName: "turn_end",
        turnIndex,
        detail: {
          turnIndex,
          stopReason: index % 2 === 0 ? "toolUse" : "endTurn",
          usage: { totalTokens: exchange.input + exchange.output, costTotal: exchange.cost },
        },
      });
    }
    turnIndex += 1;
  }

  return { records, live: [] };
}
