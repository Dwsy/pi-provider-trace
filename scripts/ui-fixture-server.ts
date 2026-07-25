import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setActiveSession } from "../src/session-context.js";
import { setTraceEnabled, setTraceLogDir, writeTrace } from "../src/logger.js";
import { startTraceWebUi, stopTraceWebUi } from "../src/web-ui.js";

const root = join(tmpdir(), "pi-provider-trace-ui-fixture");
rmSync(root, { recursive: true, force: true });
setTraceLogDir(root);
setTraceEnabled(true);

const usage = {
	provider: "anthropic",
	model: "claude-sonnet-4-5",
	input: 18420,
	output: 1387,
	cacheRead: 12160,
	cacheWrite: 0,
	totalTokens: 31967,
	costTotal: 0.0847,
	costInput: 0.0552,
	costOutput: 0.0295,
	costCacheRead: 0,
	costCacheWrite: 0,
	cacheHitRate: 0.397,
	source: "message_end" as const,
};

setActiveSession("trace-workbench-demo", "重构 Provider Trace 前端");
writeTrace({
	ts: "2026-07-11T08:00:00.000Z",
	kind: "pi_event",
	id: "evt-input",
	eventName: "input",
	summary: "input 重写请求观测台",
	detail: { source: "interactive", text: "请检查流式输出与工具调用的联动，并找出当前存储写放大的原因。" },
});
writeTrace({
	ts: "2026-07-11T08:00:00.100Z",
	kind: "request",
	id: "ex-tool",
	url: "https://api.anthropic.com/v1/messages",
	method: "POST",
	headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
	bodyPreview: JSON.stringify({
		model: "claude-sonnet-4-5",
		max_tokens: 4096,
		temperature: 0.2,
		top_p: 0.9,
		stream: true,
		tool_choice: { type: "auto" },
		thinking: { type: "enabled", budget_tokens: 8000 },
		system: "You are inspecting a local developer tool.",
		messages: [{ role: "user", content: [{ type: "text", text: "Inspect src/logger.ts and explain the persistence path." }] }],
		tools: [
			{
				name: "read",
				description: "Read a range of lines from a workspace file.",
				input_schema: {
					type: "object",
					properties: {
						path: { type: "string", description: "Workspace-relative file path" },
						offset: { type: "integer", minimum: 1 },
						limit: { type: "integer", minimum: 1 },
					},
					required: ["path"],
				},
			},
			{
				name: "bash",
				description: "Run a shell command in the workspace.",
				input_schema: {
					type: "object",
					properties: { command: { type: "string" }, timeout_ms: { type: "integer" } },
					required: ["command"],
				},
			},
		],
	}),
});
writeTrace({ ts: "2026-07-11T08:00:00.420Z", kind: "response_meta", id: "ex-tool", url: "https://api.anthropic.com/v1/messages", status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_7mh2" } });
writeTrace({
	ts: "2026-07-11T08:00:02.900Z",
	kind: "stream_result",
	id: "ex-tool",
	url: "https://api.anthropic.com/v1/messages",
	stream: {
		state: "complete",
		text: "I found the write amplification in the raw SSE persistence path. I’ll inspect the logger before proposing the boundary change.",
		reasoning: "The durable record should be the completed generation, while partial deltas are presentation state.",
		toolCalls: [{ key: "anthropic:1", callId: "toolu_read_logger", name: "read", arguments: '{"path":"src/logger.ts","offset":1,"limit":220}', state: "complete" }],
		eventCount: 64,
		byteCount: 28140,
		firstEventTs: "2026-07-11T08:00:00.790Z",
		lastEventTs: "2026-07-11T08:00:02.900Z",
		finishReason: "tool_use",
	},
});
writeTrace({ ts: "2026-07-11T08:00:02.910Z", kind: "llm_usage", id: "ex-tool", usage, summary: "usage" });
writeTrace({ ts: "2026-07-11T08:00:03.000Z", kind: "pi_event", id: "evt-tool", eventName: "tool_call", summary: "tool_call · read", detail: { toolName: "read", toolCallId: "toolu_read_logger" } });
writeTrace({ ts: "2026-07-11T08:00:03.080Z", kind: "pi_event", id: "evt-result", eventName: "tool_result", summary: "tool_result · read", detail: { toolName: "read", isError: false } });

writeTrace({
	ts: "2026-07-11T08:00:03.150Z",
	kind: "request",
	id: "ex-live",
	url: "https://api.openai.com/v1/responses",
	method: "POST",
	headers: { "content-type": "application/json" },
	bodyPreview: JSON.stringify({
		model: "gpt-5.2-codex",
		temperature: 0.35,
		top_p: 0.92,
		max_output_tokens: 2500,
		stream: true,
		reasoning: { effort: "medium" },
		tool_choice: "auto",
		parallel_tool_calls: true,
		tools: [
			{
				type: "function",
				name: "read",
				description: "Read a range of lines from a workspace file.",
				parameters: {
					type: "object",
					properties: { path: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" } },
					required: ["path"],
				},
			},
			{ type: "web_search_preview", search_context_size: "medium" },
		],
		input: [
			{ type: "function_call_output", call_id: "toolu_read_logger", output: "logger persisted every sse_line with appendFileSync" },
			{ role: "user", content: [{ type: "input_text", text: "Replace that with a final result record and keep live state in memory." }] },
		],
	}),
});
writeTrace({ ts: "2026-07-11T08:00:03.460Z", kind: "response_meta", id: "ex-live", url: "https://api.openai.com/v1/responses", status: 200, headers: { "content-type": "text/event-stream", "x-request-id": "resp_82km" } });
writeTrace({
	ts: "2026-07-11T08:00:04.100Z",
	kind: "stream_update",
	id: "ex-live",
	url: "https://api.openai.com/v1/responses",
	stream: {
		state: "streaming",
		text: "",
		reasoning: "",
		toolCalls: [],
		eventCount: 27,
		byteCount: 11680,
		firstEventTs: "2026-07-11T08:00:03.720Z",
		lastEventTs: "2026-07-11T08:00:04.100Z",
	},
	streamDelta: {
		text: "The stream is now reduced in memory. Each browser update carries a compact text patch, while the JSONL remains untouched until completion.",
		reasoning: "Keep transient transport state outside persistence.",
	},
});

setActiveSession("gemini-image-debug", "Gemini 多模态请求排障");
writeTrace({ ts: "2026-07-11T07:40:00.000Z", kind: "request", id: "ex-image", url: "https://generativelanguage.googleapis.com/v1beta/models/gemini:streamGenerateContent", method: "POST", bodyPreview: JSON.stringify({ model: "gemini-2.5-pro", contents: [{ role: "user", parts: [{ text: "Describe the attached architecture diagram" }, { inline_data: { mime_type: "image/png", data: "iVBORw0KGgoAAA..." } }] }] }) });
writeTrace({ ts: "2026-07-11T07:40:00.260Z", kind: "response_meta", id: "ex-image", status: 200, headers: { "content-type": "text/event-stream" } });
writeTrace({ ts: "2026-07-11T07:40:02.010Z", kind: "stream_result", id: "ex-image", stream: { state: "complete", text: "The diagram shows the request lifecycle from Pi events through the provider stream to one durable result.", reasoning: "", toolCalls: [], eventCount: 18, byteCount: 9420, firstEventTs: "2026-07-11T07:40:00.540Z", lastEventTs: "2026-07-11T07:40:02.010Z", finishReason: "STOP" } });

setActiveSession("trace-workbench-demo", "重构 Provider Trace 前端");
const url = await startTraceWebUi();
console.log(`ui-fixture: ${url}`);

setTimeout(() => {
	writeTrace({
		ts: "2026-07-11T08:00:04.300Z",
		kind: "stream_update",
		id: "ex-live",
		url: "https://api.openai.com/v1/responses",
		stream: {
			state: "streaming",
			text: "",
			reasoning: "",
			toolCalls: [],
			eventCount: 31,
			byteCount: 13240,
			firstEventTs: "2026-07-11T08:00:03.720Z",
			lastEventTs: "2026-07-11T08:00:04.300Z",
		},
		streamDelta: { text: " Live patches append without resending the completed prefix." },
	});
}, 600).unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		void stopTraceWebUi().finally(() => process.exit(0));
	});
}
setInterval(() => {}, 60_000).unref();
