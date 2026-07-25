import assert from "node:assert/strict";
import {
  exchangeOutputTps,
  messagesForExchange,
  requestParametersForExchange,
  thinkingLevelForExchange,
  toolDefinitionsForExchange,
} from "./model.js";
import { formatTps } from "./format.js";

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

console.log("model.test.mjs: ok");
