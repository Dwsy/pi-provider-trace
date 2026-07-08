import assert from "node:assert/strict";
import { aggregateScores } from "../score-aggregates.ts";
const a = aggregateScores([
  { schemaVersion: 1, kind: "score", id: "1", traceId: "t", name: "q", value: 4, dataType: "NUMERIC", ts: "2026-01-01" },
  { schemaVersion: 1, kind: "score", id: "2", traceId: "t", name: "q", value: 6, dataType: "NUMERIC", ts: "2026-01-01" },
]);
assert.equal(a.scoresAvg, 5);
console.log("score-aggregates.test.mjs: ok");
