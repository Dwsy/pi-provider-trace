import assert from "node:assert/strict";
import {
  buildSessionTree,
  ingestRecord,
  resetSessionTrace,
  selectTreeNode,
  sessionTreeStats,
  state,
} from "./model.js";

resetSessionTrace();

const sessionKey = "test-session";

function push(record) {
  ingestRecord({ sessionKey, ...record });
}

push({
  ts: "2026-07-22T10:00:00.000Z",
  kind: "pi_event",
  id: "e1",
  eventName: "input",
  summary: "input hello",
  detail: { text: "hello", source: "interactive", textLen: 5 },
});
push({
  ts: "2026-07-22T10:00:01.000Z",
  kind: "pi_event",
  id: "e2",
  eventName: "turn_start",
  turnIndex: 0,
  detail: { turnIndex: 0 },
});
push({
  ts: "2026-07-22T10:00:02.000Z",
  kind: "request",
  id: "ex1",
  method: "POST",
  url: "https://api.openai.com/v1/responses",
  bodyPreview: JSON.stringify({ model: "gpt-test", messages: [] }),
});
push({
  ts: "2026-07-22T10:00:03.000Z",
  kind: "stream_result",
  id: "ex1",
  stream: {
    state: "complete",
    text: "ok",
    reasoning: "",
    toolCalls: [{ key: "k1", callId: "call-1", name: "bash", arguments: "{\"command\":\"ls\"}", state: "complete" }],
    eventCount: 3,
    byteCount: 10,
    firstEventTs: "2026-07-22T10:00:02.100Z",
    lastEventTs: "2026-07-22T10:00:02.900Z",
  },
});
push({
  ts: "2026-07-22T10:00:04.000Z",
  kind: "pi_event",
  id: "e3",
  eventName: "tool_execution_start",
  turnIndex: 0,
  detail: { toolName: "bash", toolCallId: "call-1", args: { command: "ls" } },
});
push({
  ts: "2026-07-22T10:00:05.000Z",
  kind: "pi_event",
  id: "e4",
  eventName: "tool_result",
  turnIndex: 0,
  detail: {
    toolName: "bash",
    toolCallId: "call-1",
    isError: false,
    input: { command: "ls" },
    contentText: "a.txt\nb.txt",
    contentLen: 11,
  },
});
push({
  ts: "2026-07-22T10:00:06.000Z",
  kind: "pi_event",
  id: "e5",
  eventName: "turn_end",
  turnIndex: 0,
  detail: {
    turnIndex: 0,
    stopReason: "toolUse",
    toolResults: [{ toolCallId: "call-1", toolName: "bash", isError: false, contentText: "a.txt\nb.txt" }],
    usage: { totalTokens: 100, costTotal: 0.01 },
  },
});

const tree = buildSessionTree();
assert.equal(tree.prompts.length, 1);
assert.equal(tree.prompts[0].input, "hello");
assert.equal(tree.prompts[0].turns.length, 1);
const turn = tree.prompts[0].turns[0];
assert.equal(turn.turnIndex, 0);
assert.equal(turn.stopReason, "toolUse");
const kinds = turn.nodes.map((n) => n.kind);
assert.ok(kinds.includes("generation"), `expected generation, got ${kinds}`);
assert.ok(kinds.includes("tool"), `expected tool, got ${kinds}`);
const tool = turn.nodes.find((n) => n.kind === "tool");
assert.equal(tool.toolName, "bash");
assert.equal(tool.result.contentText, "a.txt\nb.txt");

const stats = sessionTreeStats(tree);
assert.equal(stats.prompts, 1);
assert.equal(stats.turns, 1);
assert.equal(stats.tools, 1);
assert.equal(stats.generations, 1);

selectTreeNode(tool);
assert.equal(state.selectedNode.kind, "tool");
assert.equal(state.selectedNode.id, tool.id);

console.log("tree.test.mjs: ok");
