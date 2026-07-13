import assert from "node:assert/strict";
import { compactLegacySseRecords } from "../../web-ui.ts";

const records = [
	{ ts: "2026-01-01T00:00:00.000Z", kind: "request", id: "ex1", sessionKey: "s1" },
	{ ts: "2026-01-01T00:00:01.000Z", kind: "sse_line", id: "ex1", sessionKey: "s1", line: 'data: {"choices":[{"delta":{"content":"hello "}}]}' },
	{ ts: "2026-01-01T00:00:02.000Z", kind: "sse_line", id: "ex1", sessionKey: "s1", line: 'data: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}]}' },
	{ ts: "2026-01-01T00:00:03.000Z", kind: "sse_line", id: "ex1", sessionKey: "s1", line: "data: [DONE]" },
	{ ts: "2026-01-01T00:00:03.100Z", kind: "llm_usage", id: "ex1", sessionKey: "s1" },
];

const compacted = compactLegacySseRecords(records);
assert.equal(compacted.some((record) => record.kind === "sse_line"), false);
assert.equal(compacted.filter((record) => record.kind === "stream_result").length, 1);
assert.equal(compacted.find((record) => record.kind === "stream_result").stream.text, "hello world");
assert.deepEqual(compacted.map((record) => record.kind), ["request", "stream_result", "llm_usage"]);

console.log("legacy-sse-compaction.test.mjs: ok");
