import assert from "node:assert/strict";
import { parseSseLine as parseAnthropicSse } from "../providers/anthropic.ts";
import { parseSseLine as parseOpenaiResponsesSse } from "../providers/openai-responses.ts";

const anthro = parseAnthropicSse('data: {"type":"message_start","message":{"usage":{"input_tokens":3,"output_tokens":0}}}');
assert.ok(anthro);
assert.equal(anthro.input, 3);

const oai = parseOpenaiResponsesSse('data: {"type":"response.completed","response":{"model":"gpt-4o","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}}');
assert.ok(oai);
assert.equal(oai.output, 2);

console.log("providers.test.mjs: ok");
