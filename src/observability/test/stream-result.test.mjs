import assert from "node:assert/strict";
import { StreamAccumulator } from "../../stream-result.ts";

const data = (value) => `data: ${JSON.stringify(value)}`;

{
	const stream = new StreamAccumulator();
	stream.acceptLine(data({ choices: [{ delta: { content: "ha" } }] }), "2026-01-01T00:00:01.000Z");
	stream.acceptLine(data({ choices: [{ delta: { content: "ha" }, finish_reason: "stop" }] }), "2026-01-01T00:00:02.000Z");
	stream.acceptLine("data: [DONE]", "2026-01-01T00:00:03.000Z");
	const result = stream.snapshot("complete");
	assert.equal(result.text, "haha", "repeated delta tokens must not be deduplicated");
	assert.equal(result.finishReason, "stop");
	assert.equal(result.eventCount, 3);
	assert.equal(result.firstEventTs, "2026-01-01T00:00:01.000Z");
	assert.equal(result.lastEventTs, "2026-01-01T00:00:03.000Z");
}

{
	const stream = new StreamAccumulator();
	stream.acceptLine(data({ candidates: [{ content: { parts: [{ text: "same" }] } }] }));
	stream.acceptLine(data({ candidates: [{ content: { parts: [{ text: "same" }] } }] }));
	assert.equal(stream.snapshot("complete").text, "samesame");
}

{
	const stream = new StreamAccumulator();
	stream.acceptLine(data({
		type: "response.output_item.added",
		output_index: 0,
		item: { id: "item_1", type: "function_call", call_id: "call_1", name: "read", arguments: "" },
	}));
	stream.acceptLine(data({ type: "response.function_call_arguments.delta", item_id: "item_1", delta: '{"path":' }));
	stream.acceptLine(data({ type: "response.function_call_arguments.done", item_id: "item_1", arguments: '{"path":"a.ts"}' }));
	stream.acceptLine(data({ type: "response.output_text.delta", delta: "done" }));
	const result = stream.snapshot("complete");
	assert.equal(result.text, "done");
	assert.deepEqual(result.toolCalls[0], {
		key: "openai-response:item_1",
		callId: "call_1",
		name: "read",
		arguments: '{"path":"a.ts"}',
		state: "complete",
	});
}

{
	const stream = new StreamAccumulator();
	stream.acceptLine(data({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "bash", input: {} } }));
	stream.acceptLine(data({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"command":' } }));
	stream.acceptLine(data({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"pwd"}' } }));
	stream.acceptLine(data({ type: "content_block_stop", index: 1 }));
	stream.acceptLine(data({ type: "content_block_delta", index: 2, delta: { type: "thinking_delta", thinking: "checking" } }));
	const result = stream.snapshot("complete");
	assert.equal(result.reasoning, "checking");
	assert.equal(result.toolCalls[0].arguments, '{"command":"pwd"}');
	assert.equal(result.toolCalls[0].state, "complete");
}

{
	const stream = new StreamAccumulator();
	stream.acceptLine(JSON.stringify({
		candidates: [{ content: { parts: [{ text: "Gemini result" }, { functionCall: { name: "search", args: { q: "trace" } } }] }, finishReason: "STOP" }],
	}));
	const result = stream.snapshot("complete");
	assert.equal(result.text, "Gemini result");
	assert.equal(result.finishReason, "STOP");
	assert.equal(result.toolCalls[0].name, "search");
}

{
	const stream = new StreamAccumulator();
	stream.acceptLine(JSON.stringify({
		id: "resp_final",
		object: "response",
		output: [
			{ type: "message", content: [{ type: "output_text", text: "non-stream response" }] },
			{ type: "function_call", id: "item_final", call_id: "call_final", name: "write", arguments: '{"path":"x"}' },
		],
	}));
	const result = stream.snapshot("complete");
	assert.equal(result.text, "non-stream response");
	assert.equal(result.toolCalls[0].callId, "call_final");
	assert.equal(result.toolCalls[0].state, "complete");
}

console.log("stream-result.test.mjs: ok");
