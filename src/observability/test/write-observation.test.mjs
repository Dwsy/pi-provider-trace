import assert from "node:assert/strict";
import { observationFromLlmUsage, observationTraceLine } from "../write-observation.ts";

const rec = {
  ts: "2026-01-01T00:00:00Z",
  kind: "llm_usage",
  id: "ex1",
  sessionKey: "sess",
  usage: {
    input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
    costTotal: 0, costInput: 0, costOutput: 0, costCacheRead: 0, costCacheWrite: 0,
    cacheHitRate: 0, source: "sse", provider: "openai", model: "gpt-4o",
  },
};
const obs = observationFromLlmUsage(rec);
assert.ok(obs);
assert.equal(obs.observationType, "generation");
const line = observationTraceLine(rec);
assert.ok(line);
assert.equal(line.kind, "observation");
console.log("write-observation.test.mjs: ok");
