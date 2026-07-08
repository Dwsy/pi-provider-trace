import assert from "node:assert/strict";
import {
	foldExchangeFromRecords,
	deriveGenerationMetrics,
	rollupTraceMetrics,
} from "../derive-metrics.ts";

const records = [
	{ ts: "2026-01-01T00:00:00.000Z", kind: "request", id: "ex1", url: "https://api.anthropic.com/v1/messages" },
	{ ts: "2026-01-01T00:00:01.000Z", kind: "sse_line", id: "ex1", line: "data: {}" },
	{ ts: "2026-01-01T00:00:02.000Z", kind: "sse_line", id: "ex1", line: "data: [DONE]" },
	{
		ts: "2026-01-01T00:00:02.100Z",
		kind: "llm_usage",
		id: "ex1",
		usage: {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 15,
			costTotal: 0.01,
			costInput: 0.004,
			costOutput: 0.006,
			costCacheRead: 0,
			costCacheWrite: 0,
			cacheHitRate: 0,
			source: "sse",
		},
	},
	{ ts: "2026-01-01T00:00:03.000Z", kind: "pi_event", id: "evt1", eventName: "tool_call", summary: "x" },
];

const map = foldExchangeFromRecords(records);
assert.equal(map.size, 1);
const ex = map.get("ex1");
assert.ok(ex);
assert.equal(ex.sseLineCount, 2);

const gen = deriveGenerationMetrics(ex);
assert.ok(gen);
assert.equal(gen.inputTokens, 10);
assert.equal(gen.latencyMs, 2000);
assert.equal(gen.timeToFirstTokenMs, 1000);

const trace = rollupTraceMetrics(records);
assert.equal(trace.generationCount, 1);
assert.equal(trace.totalTokens, 15);
assert.equal(trace.spanCount, 1);
assert.equal(trace.eventCount, 1);

console.log("derive-metrics.test.mjs: ok");
