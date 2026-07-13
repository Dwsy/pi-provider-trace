export type StreamToolCall = {
	key: string;
	callId?: string;
	name?: string;
	arguments: string;
	state: "streaming" | "complete";
};

export type StreamSnapshot = {
	state: "streaming" | "complete" | "error";
	text: string;
	reasoning: string;
	toolCalls: StreamToolCall[];
	eventCount: number;
	byteCount: number;
	firstEventTs?: string;
	lastEventTs?: string;
	finishReason?: string;
	error?: string;
};

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonObject)
		: undefined;
}

function array(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function identity(value: unknown): string | undefined {
	if (typeof value === "string" && value) return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return undefined;
}

function stringify(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function appendDelta(current: string, next: string | undefined): string {
	return next ? current + next : current;
}

function mergeCompleted(current: string, completed: string): string {
	if (!completed) return current;
	if (!current || completed.startsWith(current)) return completed;
	if (current.endsWith(completed)) return current;
	return current + completed;
}

/**
 * Incrementally reduces provider wire events into one display-ready result.
 * Raw SSE rows are deliberately never retained by this object.
 */
export class StreamAccumulator {
	private text = "";
	private reasoning = "";
	private eventCount = 0;
	private byteCount = 0;
	private firstEventTs: string | undefined;
	private lastEventTs: string | undefined;
	private finishReason: string | undefined;
	private calls: StreamToolCall[] = [];
	private callsByKey = new Map<string, StreamToolCall>();
	private callAliases = new Map<string, StreamToolCall>();

	acceptLine(line: string, ts = new Date().toISOString()): boolean {
		const trimmed = line.trim();
		if (!trimmed) return false;

		this.eventCount += 1;
		this.byteCount += Buffer.byteLength(line, "utf8");
		this.firstEventTs ??= ts;
		this.lastEventTs = ts;

		if (trimmed.startsWith("event:")) return false;

		let payload = trimmed;
		let rawResponse = true;
		if (trimmed.startsWith("data:")) {
			payload = trimmed.slice(5).trim();
			rawResponse = false;
		}
		if (!payload || payload === "[DONE]") {
			if (payload === "[DONE]") this.finishReason ??= "stop";
			return payload === "[DONE]";
		}

		try {
			const parsed = JSON.parse(payload) as unknown;
			const value = object(parsed);
			if (!value) return false;
			this.applyObject(value, rawResponse);
			return true;
		} catch {
			return false;
		}
	}

	snapshot(state: StreamSnapshot["state"] = "streaming", error?: string): StreamSnapshot {
		return {
			state,
			text: this.text,
			reasoning: this.reasoning,
			toolCalls: this.calls.map((call) => ({ ...call })),
			eventCount: this.eventCount,
			byteCount: this.byteCount,
			firstEventTs: this.firstEventTs,
			lastEventTs: this.lastEventTs,
			finishReason: this.finishReason,
			error,
		};
	}

	private applyObject(value: JsonObject, rawResponse: boolean): void {
		const type = string(value.type) ?? "";

		this.applyOpenAiChat(value);
		this.applyOpenAiResponses(value, type);
		this.applyAnthropic(value, type);
		this.applyGoogle(value);
		this.applyBedrock(value);
		this.captureFinishReason(value, type);

		if (rawResponse) this.applyFullResponse(value);
	}

	private applyOpenAiChat(value: JsonObject): void {
		for (const [choicePosition, rawChoice] of array(value.choices).entries()) {
			const choice = object(rawChoice);
			if (!choice) continue;
			const choiceKey = identity(choice.index) ?? String(choicePosition);
			const delta = object(choice.delta);
			if (delta) {
				if (choicePosition === 0) {
					this.text = appendDelta(this.text, string(delta.content) ?? string(delta.text));
					this.reasoning = appendDelta(
						this.reasoning,
						string(delta.reasoning_content) ?? string(delta.reasoning),
					);
				}
				this.applyOpenAiToolCalls(delta, choiceKey);
			}
			const finish = string(choice.finish_reason);
			if (finish) {
				this.finishReason = finish;
				for (const call of this.calls) {
					if (call.key.startsWith(`openai-chat:${choiceKey}:`)) call.state = "complete";
				}
			}
		}
	}

	private applyOpenAiToolCalls(delta: JsonObject, choiceKey: string): void {
		for (const [position, rawCall] of array(delta.tool_calls).entries()) {
			const callDelta = object(rawCall);
			if (!callDelta) continue;
			const index = identity(callDelta.index) ?? String(position);
			const call = this.ensureCall(`openai-chat:${choiceKey}:${index}`);
			const fn = object(callDelta.function);
			this.rememberCall(call, identity(callDelta.id));
			call.callId = identity(callDelta.id) ?? call.callId;
			call.name = string(fn?.name) ?? string(callDelta.name) ?? call.name;
			this.appendArguments(call, string(fn?.arguments) ?? string(callDelta.arguments));
		}

		const legacy = object(delta.function_call);
		if (!legacy) return;
		const call = this.ensureCall(`openai-chat:${choiceKey}:legacy`);
		call.name = string(legacy.name) ?? call.name;
		this.appendArguments(call, string(legacy.arguments));
	}

	private applyOpenAiResponses(value: JsonObject, type: string): void {
		if (
			type === "response.output_text.delta" ||
			type === "response.refusal.delta"
		) {
			this.text = appendDelta(this.text, string(value.delta));
		}
		if (
			type === "response.reasoning_summary_text.delta" ||
			type === "response.reasoning_text.delta"
		) {
			this.reasoning = appendDelta(this.reasoning, string(value.delta));
		}

		const item = object(value.item);
		if (type === "response.output_item.added" && string(item?.type) === "function_call") {
			this.responseCall(value, item);
		}
		if (type === "response.function_call_arguments.delta") {
			this.appendArguments(this.responseCall(value), string(value.delta));
		}
		if (type === "response.function_call_arguments.done") {
			const call = this.responseCall(value);
			this.setArguments(call, value.arguments);
			call.state = "complete";
		}
		if (type === "response.output_item.done" && string(item?.type) === "function_call") {
			const call = this.responseCall(value, item);
			this.setArguments(call, item?.arguments);
			call.state = "complete";
		}
		if (type === "response.completed") {
			const response = object(value.response);
			if (response) this.applyResponsesOutput(response);
		}
	}

	private applyResponsesOutput(response: JsonObject): void {
		let completedText = "";
		let completedReasoning = "";
		for (const rawItem of array(response.output)) {
			const item = object(rawItem);
			if (!item) continue;
			const type = string(item.type);
			if (type === "function_call") {
				const call = this.responseCall(
					{ item_id: item.id, call_id: item.call_id },
					item,
				);
				this.setArguments(call, item.arguments);
				call.state = "complete";
			}
			for (const rawContent of array(item.content)) {
				const content = object(rawContent);
				if (!content) continue;
				if (string(content.type) === "output_text" || string(content.type) === "refusal") {
					completedText += string(content.text) ?? string(content.refusal) ?? "";
				}
			}
			for (const rawSummary of array(item.summary)) {
				const summary = object(rawSummary);
				completedReasoning += string(summary?.text) ?? "";
			}
		}
		this.text = mergeCompleted(this.text, completedText);
		this.reasoning = mergeCompleted(this.reasoning, completedReasoning);
	}

	private responseCall(value: JsonObject, item?: JsonObject): StreamToolCall {
		const itemId = identity(value.item_id) ?? identity(item?.id);
		const callId = identity(value.call_id) ?? identity(item?.call_id);
		const known = (itemId && this.callAliases.get(itemId)) || (callId && this.callAliases.get(callId));
		const key = itemId ?? callId ?? identity(value.output_index) ?? String(this.calls.length);
		const call = known ?? this.ensureCall(`openai-response:${key}`);
		this.rememberCall(call, itemId, callId, identity(item?.id), identity(item?.call_id));
		call.callId = callId ?? identity(item?.call_id) ?? call.callId;
		call.name = string(item?.name) ?? call.name;
		this.setArguments(call, item?.arguments);
		return call;
	}

	private applyAnthropic(value: JsonObject, type: string): void {
		const delta = object(value.delta);
		if (type === "content_block_delta") {
			if (string(delta?.type) === "text_delta") {
				this.text = appendDelta(this.text, string(delta?.text));
			}
			if (string(delta?.type) === "thinking_delta") {
				this.reasoning = appendDelta(this.reasoning, string(delta?.thinking));
			}
			if (string(delta?.type) === "input_json_delta") {
				const call = this.callsByKey.get(`anthropic:${identity(value.index) ?? "0"}`);
				if (call) this.appendArguments(call, string(delta?.partial_json));
			}
		}

		const block = object(value.content_block);
		if (type === "content_block_start" && string(block?.type) === "tool_use") {
			const index = identity(value.index) ?? String(this.calls.length);
			const call = this.ensureCall(`anthropic:${index}`);
			call.callId = identity(block?.id) ?? call.callId;
			call.name = string(block?.name) ?? call.name;
			this.rememberCall(call, call.callId);
			this.setArguments(call, block?.input);
		}
		if (type === "content_block_stop") {
			const call = this.callsByKey.get(`anthropic:${identity(value.index) ?? "0"}`);
			if (call) call.state = "complete";
		}
	}

	private applyGoogle(value: JsonObject): void {
		for (const [candidatePosition, rawCandidate] of array(value.candidates).entries()) {
			const candidate = object(rawCandidate);
			const content = object(candidate?.content);
			for (const [position, rawPart] of array(content?.parts).entries()) {
				const part = object(rawPart);
				if (!part) continue;
				if (candidatePosition === 0) this.text = appendDelta(this.text, string(part.text));
				const fn = object(part.functionCall);
				if (!fn) continue;
				const name = string(fn.name) ?? "function";
				const call = this.ensureCall(`google:${name}:${position}`);
				call.name = name;
				this.setArguments(call, fn.args);
				call.state = "complete";
			}
			const finish = string(candidate?.finishReason);
			if (finish) this.finishReason = finish;
		}
	}

	private applyBedrock(value: JsonObject): void {
		const delta = object(object(value.contentBlockDelta)?.delta);
		this.text = appendDelta(this.text, string(delta?.text));
		const toolUse = object(delta?.toolUse);
		if (toolUse) {
			const index = identity(object(value.contentBlockDelta)?.contentBlockIndex) ?? "0";
			const call = this.ensureCall(`bedrock:${index}`);
			call.callId = identity(toolUse.toolUseId) ?? call.callId;
			call.name = string(toolUse.name) ?? call.name;
			this.appendArguments(call, string(toolUse.input));
			this.rememberCall(call, call.callId);
		}
		const stopReason = string(object(value.messageStop)?.stopReason);
		if (stopReason) this.finishReason = stopReason;
	}

	private applyFullResponse(value: JsonObject): void {
		if (Array.isArray(value.output)) this.applyResponsesOutput(value);
		for (const [choicePosition, rawChoice] of array(value.choices).entries()) {
			const message = object(object(rawChoice)?.message);
			if (choicePosition === 0) this.text = mergeCompleted(this.text, string(message?.content) ?? "");
			if (message) this.applyOpenAiToolCalls(message, `final:${choicePosition}`);
		}

		let completedText = "";
		let completedReasoning = "";
		for (const [position, rawBlock] of array(value.content).entries()) {
			const block = object(rawBlock);
			if (!block) continue;
			if (string(block.type) === "text") completedText += string(block.text) ?? "";
			if (string(block.type) === "thinking") {
				completedReasoning += string(block.thinking) ?? "";
			}
			if (string(block.type) === "tool_use") {
				const call = this.ensureCall(`anthropic-final:${position}`);
				call.callId = identity(block.id);
				call.name = string(block.name);
				this.setArguments(call, block.input);
				call.state = "complete";
			}
		}
		this.text = mergeCompleted(this.text, completedText);
		this.reasoning = mergeCompleted(this.reasoning, completedReasoning);
	}

	private captureFinishReason(value: JsonObject, type: string): void {
		if (type === "message_delta") {
			this.finishReason = string(object(value.delta)?.stop_reason) ?? this.finishReason;
		}
		if (type === "message_stop") this.finishReason ??= "end_turn";
		if (type === "response.completed") {
			this.finishReason = string(object(value.response)?.status) ?? "completed";
		}
		if (type === "response.failed") this.finishReason = "failed";
		if (type === "response.incomplete") this.finishReason = "incomplete";
	}

	private ensureCall(key: string): StreamToolCall {
		const existing = this.callsByKey.get(key);
		if (existing) return existing;
		const call: StreamToolCall = { key, arguments: "", state: "streaming" };
		this.callsByKey.set(key, call);
		this.calls.push(call);
		return call;
	}

	private rememberCall(call: StreamToolCall, ...ids: Array<string | undefined>): void {
		for (const id of ids) if (id) this.callAliases.set(id, call);
	}

	private setArguments(call: StreamToolCall, value: unknown): void {
		if (value == null || value === "") return;
		const next = stringify(value);
		if (!next) return;
		call.arguments = next;
	}

	private appendArguments(call: StreamToolCall, value: string | undefined): void {
		if (!value) return;
		if (call.arguments === "{}") call.arguments = "";
		call.arguments += value;
	}
}
