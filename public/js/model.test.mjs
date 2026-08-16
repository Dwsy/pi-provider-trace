import assert from "node:assert/strict";
import {
  exchangeOutputTps,
  messagesForExchange,
  requestParametersForExchange,
  sortOverviewRows,
  thinkingLevelForExchange,
  toolDefinitionsForExchange,
} from "./model.js";
import {
  formatCostMeasured,
  formatCount,
  formatPercent,
  formatTokensMeasured,
  formatTps,
} from "./format.js";
import { overviewFixture } from "./fixture.js";

// Formatters read the locale off the document; the tests run headless.
globalThis.document = { documentElement: { dataset: { locale: "en" } } };

function exchange(body) {
  return { request: { bodyPreview: JSON.stringify(body) } };
}

const openai = exchange({
  model: "gpt-test",
  temperature: 0.25,
  max_output_tokens: 1200,
  stream: true,
  reasoning: { effort: "medium" },
  input: [
    { type: "function_call", call_id: "call_1", name: "read", arguments: '{"path":"src/index.ts"}' },
    { type: "function_call_output", call_id: "call_1", output: "file contents" },
  ],
  tools: [
    {
      type: "function",
      name: "read",
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
    { type: "web_search_preview", search_context_size: "medium" },
  ],
});

const parameters = requestParametersForExchange(openai);
assert.deepEqual(parameters.slice(0, 4).map((entry) => entry.key), ["model", "temperature", "max_output_tokens", "stream"]);
assert.equal(parameters.some((entry) => entry.key === "input"), false);
assert.equal(parameters.some((entry) => entry.key === "tools"), false);
assert.deepEqual(parameters.find((entry) => entry.key === "reasoning")?.value, { effort: "medium" });
assert.equal(thinkingLevelForExchange(openai), "medium");

const tools = toolDefinitionsForExchange(openai);
assert.equal(tools.length, 2);
assert.equal(tools[0].name, "read");
assert.deepEqual(tools[0].parameters.required, ["path"]);
assert.equal(tools[1].name, "web_search_preview");

const messages = messagesForExchange(openai);
assert.equal(messages[0].toolCalls[0].callId, "call_1");
assert.equal(messages[0].toolCalls[0].name, "read");
assert.equal(messages[1].toolResults[0].output, "file contents");

const google = exchange({
  model: "gemini-test",
  generationConfig: { temperature: 0.7, topP: 0.8, maxOutputTokens: 512 },
  contents: [{ role: "user", parts: [{ text: "hello" }] }],
  tools: [{ functionDeclarations: [{ name: "lookup", parameters: { type: "object" } }] }],
});
assert.deepEqual(
  requestParametersForExchange(google).map((entry) => entry.key),
  ["model", "generationConfig.temperature", "generationConfig.topP", "generationConfig.maxOutputTokens"],
);
assert.equal(toolDefinitionsForExchange(google)[0].name, "lookup");
assert.equal(thinkingLevelForExchange(google), null);

const anthropic = exchange({
  model: "claude-test",
  thinking: { type: "enabled", budget_tokens: 8000 },
});
assert.equal(thinkingLevelForExchange(anthropic), "enabled · 8k");

const tpsExchange = {
  usage: { output: 1387 },
  stream: {
    firstEventTs: "2026-07-11T08:00:00.790Z",
    lastEventTs: "2026-07-11T08:00:02.900Z",
  },
};
assert.ok(Math.abs(exchangeOutputTps(tpsExchange) - 1387 / 2.11) < 0.01);
assert.equal(formatTps(42.35), "42.4/s");
assert.equal(formatTps(0), "—");

// A measured zero is a fact; only null may collapse into the em dash.
assert.equal(formatCount(0), "0");
assert.equal(formatCount(12_345), "12,345");
assert.equal(formatTokensMeasured(0), "0");
assert.equal(formatTokensMeasured(12_400), "12k");
assert.equal(formatCostMeasured(0), "$0.00");
assert.equal(formatPercent(3, 140), "2.1%");
assert.equal(formatPercent(0, 0), null);

// An empty sample never wins a ranking, in either direction.
const ranked = [
  { key: "a", p95TtftMs: 900 },
  { key: "b", p95TtftMs: null },
  { key: "c", p95TtftMs: 120 },
];
assert.deepEqual(sortOverviewRows(ranked, "p95TtftMs", "desc").map((row) => row.key), ["a", "c", "b"]);
assert.deepEqual(sortOverviewRows(ranked, "p95TtftMs", "asc").map((row) => row.key), ["c", "a", "b"]);
assert.deepEqual(sortOverviewRows(ranked, "key", "asc").map((row) => row.key), ["a", "b", "c"]);
assert.deepEqual(ranked.map((row) => row.key), ["a", "b", "c"], "sorting must not mutate the input");

// The fixture is the frontend's stand-in for /api/overview, so it must hold the contract.
const overview = overviewFixture("7d", 50);
assert.equal(overview.window, "7d");
assert.equal(typeof overview.generatedAt, "string");
assert.equal(typeof overview.windowStart, "string");
assert.equal(overviewFixture("all", 50).windowStart, null);
assert.ok(overview.sessions.length > 0 && overview.sessions.length <= 50);
for (const key of ["sessions", "included", "bytes", "truncated", "durationMs"]) {
  assert.ok(key in overview.scanned, `scanned.${key} missing`);
}
const totals = overview.totals;
assert.equal(
  totals.totalTokens,
  totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens,
);
assert.ok(totals.cacheHitRate >= 0 && totals.cacheHitRate <= 1);
assert.ok(totals.p95TtftMs >= totals.p50TtftMs);
assert.deepEqual(
  overview.sessions.map((row) => row.lastTs),
  [...overview.sessions.map((row) => row.lastTs)].sort().reverse(),
  "sessions are newest first",
);
assert.deepEqual(
  overview.models.map((row) => row.totalCost),
  [...overview.models.map((row) => row.totalCost)].sort((left, right) => right - left),
  "models are ordered by descending cost",
);
const nullable = ["avgTtftMs", "p95TtftMs", "avgOutputTps"];
for (const row of [...overview.models, ...overview.providers, ...overview.sessions, ...overview.timeline]) {
  for (const key of nullable) {
    if (!(key in row)) continue;
    assert.ok(row[key] === null || row[key] > 0, `${key} must be null or positive, got ${row[key]}`);
  }
}
assert.ok(
  overview.models.some((row) => row.p95TtftMs === null),
  "fixture must exercise the empty-sample path",
);
const buckets = overview.timeline.map((bucket) => Date.parse(bucket.bucket));
assert.deepEqual(buckets, [...buckets].sort((left, right) => left - right), "timeline is ascending");
const step = buckets[1] - buckets[0];
assert.ok(buckets.every((value, index) => index === 0 || value - buckets[index - 1] === step), "timeline is gap-filled");
assert.equal(overviewFixture("24h", 50).timeline.length, 25);

console.log("model.test.mjs: ok");
