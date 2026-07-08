import assert from "node:assert/strict";
import { buildLangfuseGenerationBatch, postLangfuseBatch } from "../sinks/langfuse.ts";

const batch = buildLangfuseGenerationBatch({
  traceId: "sess1",
  observationId: "ex1",
  name: "generation",
  model: "claude",
  metrics: { inputTokens: 1, outputTokens: 2, totalCost: 0.01, latencyMs: 100 },
});
assert.ok(batch.batch);

let called = false;
const mockFetch = async () => {
  called = true;
  return { ok: true, status: 200 };
};
const r = await postLangfuseBatch(
  { host: "https://lf.example", publicKey: "pk", secretKey: "sk", enabled: true },
  batch,
  mockFetch,
);
assert.equal(r.ok, true);
assert.equal(called, true);
console.log("langfuse-sink.test.mjs: ok");
