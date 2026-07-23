/**
 * Pi lifecycle → JSONL pi_event capture.
 * Hierarchy aligned with pi-langfuse: prompt → turn → generation/tool/message.
 * Full content is bounded (not summary-only); wire HTTP remains in fetch layer.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { applySessionFromCtx } from "./session-context.js";
import { getActiveExchangeId, getMostRecentExchangeId } from "./http-exchange-context.js";
import { isTraceEnabled, writeTrace } from "./logger.js";
import { fromPiUsage, type PiUsage } from "./usage-metrics.js";

/** Capture budgets (chars). Full-debug default; raise only if UI/JSONL size becomes an issue. */
const BUDGET = {
	text: 48_000,
	tool: 48_000,
	args: 24_000,
	message: 48_000,
	summary: 120,
	input: 8_000,
} as const;

function evtId(): string {
	return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function trunc(s: string, max = BUDGET.summary): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max)}…`;
}

function boundText(value: unknown, max: number): string {
	const text = value == null ? "" : typeof value === "string" ? value : safeStringify(value);
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function boundJson(value: unknown, max: number): unknown {
	if (value == null) return value;
	if (typeof value === "string") return boundText(value, max);
	const raw = safeStringify(value);
	if (raw.length <= max) return value;
	return {
		_truncated: true,
		preview: raw.slice(0, max),
		originalChars: raw.length,
	};
}

function contentText(content: unknown): string {
	if (content == null) return "";
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return safeStringify(content);
	const parts: string[] = [];
	for (const block of content) {
		if (typeof block === "string") {
			parts.push(block);
			continue;
		}
		if (!block || typeof block !== "object") continue;
		const b = block as Record<string, unknown>;
		if (typeof b.text === "string") parts.push(b.text);
		else if (typeof b.thinking === "string") parts.push(b.thinking);
		else if (b.type === "image" || b.type === "image_url") parts.push("[image]");
	}
	return parts.join("\n");
}

function messageSnapshot(message: unknown): Record<string, unknown> | undefined {
	if (!message || typeof message !== "object") return undefined;
	const m = message as Record<string, unknown>;
	const role = typeof m.role === "string" ? m.role : "unknown";
	const content = m.content;
	const text = boundText(contentText(content), BUDGET.message);
	const thinking =
		Array.isArray(content)
			? boundText(
					(content as Array<Record<string, unknown>>)
						.filter((b) => b?.type === "thinking" && typeof b.thinking === "string")
						.map((b) => String(b.thinking))
						.join("\n"),
					BUDGET.message,
				)
			: "";
	const toolCalls: Array<Record<string, unknown>> = [];
	if (Array.isArray(content)) {
		for (const block of content as Array<Record<string, unknown>>) {
			if (block?.type === "toolCall" || block?.type === "tool_use") {
				toolCalls.push({
					id: block.id,
					name: block.name,
					arguments: boundJson(block.arguments ?? block.input, BUDGET.args),
				});
			}
		}
	}
	const out: Record<string, unknown> = {
		role,
		text,
		textLen: contentText(content).length,
		stopReason: m.stopReason,
		provider: m.provider,
		model: m.model,
		api: m.api,
		toolCallId: m.toolCallId,
		toolName: m.toolName,
		isError: m.isError,
	};
	if (thinking) out.thinking = thinking;
	if (toolCalls.length) out.toolCalls = toolCalls;
	if (m.usage && typeof m.usage === "object") {
		out.usage = fromPiUsage(m.usage as PiUsage, "message_end");
	}
	if (typeof m.errorMessage === "string" && m.errorMessage) {
		out.errorMessage = boundText(m.errorMessage, 2000);
	}
	return out;
}

/** Pi session tree / compact / switch / fork — same timeline lane as other pi_event */
export const SESSION_STRUCTURE_EVENTS = [
	"session_before_switch",
	"session_switch",
	"session_before_fork",
	"session_fork",
	"session_before_compact",
	"session_compact",
	"session_before_tree",
	"session_tree",
	"session_info_changed",
] as const;

function summarize(eventName: string, event: unknown): string {
	const e = event as Record<string, unknown>;
	switch (eventName) {
		case "session_before_switch":
			return `before_switch · ${String(e.reason ?? "?")} → ${basenamePath(e.targetSessionFile)}`;
		case "session_switch":
			return `switch · ${String(e.reason ?? "?")} prev=${basenamePath(e.previousSessionFile)}`;
		case "session_before_fork":
			return `before_fork · entry ${String(e.entryId ?? "?").slice(0, 12)}`;
		case "session_fork":
			return `fork · ${basenamePath(e.newSessionFile ?? e.sessionFile)}`;
		case "session_before_compact": {
			const prep = e.preparation as { tokensBefore?: number } | undefined;
			const tok = prep?.tokensBefore != null ? ` ~${prep.tokensBefore} tok` : "";
			return `before_compact · ${String(e.reason ?? "manual")}${tok}`;
		}
		case "session_compact": {
			const entry = e.compactionEntry as { summary?: string } | undefined;
			const sum = entry?.summary ? trunc(entry.summary.replace(/\s+/g, " "), 60) : "";
			return `compact done · ${String(e.reason ?? "?")} retry=${String(e.willRetry ?? false)} ${sum}`;
		}
		case "session_before_tree": {
			const prep = e.preparation as { targetId?: string } | undefined;
			return `before_tree · target ${String(prep?.targetId ?? e.targetId ?? "?").slice(0, 12)}`;
		}
		case "session_tree":
			return `tree · leaf ${String(e.oldLeafId ?? "?").slice(0, 8)} → ${String(e.newLeafId ?? "?").slice(0, 8)}`;
		case "session_info_changed":
			return `session_info · name=${String(e.name ?? "(cleared)")}`;
		case "input": {
			const text = typeof e.text === "string" ? e.text : "";
			return `input ${trunc(text.replace(/\s+/g, " ").trim(), 80)} (${String(e.source ?? "?")})`;
		}
		case "turn_start":
			return `turn #${String(e.turnIndex ?? "?")} start`;
		case "turn_end": {
			const msg = e.message as { stopReason?: string } | undefined;
			return `turn #${String(e.turnIndex ?? "?")} end · ${msg?.stopReason ?? "?"}`;
		}
		case "tool_call":
			return `tool_call · ${String(e.toolName ?? "?")}`;
		case "tool_result":
			return `tool_result · ${String(e.toolName ?? "?")}${e.isError ? " · error" : ""}`;
		case "tool_execution_start":
			return `tool_exec start · ${String(e.toolName ?? "?")}`;
		case "tool_execution_end":
			return `tool_exec end · ${String(e.toolName ?? "?")}${e.isError ? " · error" : ""}`;
		case "before_provider_request":
			return "LLM request payload built";
		case "after_provider_response":
			return `provider HTTP ${String(e.status ?? "?")}`;
		case "message_start": {
			const m = e.message as { role?: string } | undefined;
			return `message_start · ${m?.role ?? "?"}`;
		}
		case "message_end": {
			const m = e.message as { role?: string; stopReason?: string } | undefined;
			return `message_end · ${m?.role ?? "?"} · ${m?.stopReason ?? ""}`.trim();
		}
		case "context":
			return `context · ${Array.isArray(e.messages) ? e.messages.length : 0} msgs`;
		case "agent_start":
			return "agent loop start";
		case "agent_end":
			return `agent loop end · ${Array.isArray(e.messages) ? e.messages.length : 0} msgs`;
		case "before_agent_start":
			return "before_agent_start";
		case "model_select": {
			const model = e.model as { provider?: string; id?: string } | undefined;
			return `model · ${model?.provider ?? "?"}/${model?.id ?? "?"}`;
		}
		case "session_start":
			return `session_start · ${String(e.reason ?? "")}`;
		case "session_shutdown":
			return `session_shutdown · ${String(e.reason ?? "quit")}`;
		default:
			return eventName;
	}
}

function basenamePath(v: unknown): string {
	if (typeof v !== "string" || !v) return "—";
	const parts = v.split(/[/\\]/);
	return parts[parts.length - 1] ?? v;
}

function toolResultSnapshot(e: Record<string, unknown>): Record<string, unknown> {
	const content = e.content;
	const text = contentText(content);
	return {
		toolName: e.toolName,
		toolCallId: e.toolCallId,
		isError: Boolean(e.isError),
		input: boundJson(e.input, BUDGET.args),
		contentText: boundText(text, BUDGET.tool),
		contentLen: text.length,
		// full structured content when small enough
		content: boundJson(content, BUDGET.tool),
		details: boundJson(e.details, Math.min(BUDGET.tool, 12_000)),
		usage: e.usage && typeof e.usage === "object" ? fromPiUsage(e.usage as PiUsage, "tool_result") : undefined,
	};
}

function compactDetail(eventName: string, event: unknown): Record<string, unknown> | undefined {
	const e = event as Record<string, unknown>;
	try {
		switch (eventName) {
			case "session_before_compact": {
				const prep = e.preparation as Record<string, unknown> | undefined;
				return {
					reason: e.reason,
					willRetry: e.willRetry,
					tokensBefore: prep?.tokensBefore,
					firstKeptEntryId: prep?.firstKeptEntryId,
					branchEntries: Array.isArray(e.branchEntries) ? e.branchEntries.length : undefined,
				};
			}
			case "session_compact": {
				const entry = e.compactionEntry as Record<string, unknown> | undefined;
				return {
					reason: e.reason,
					willRetry: e.willRetry,
					fromExtension: e.fromExtension,
					tokensBefore: entry?.tokensBefore,
					firstKeptEntryId: entry?.firstKeptEntryId,
					summaryPreview:
						typeof entry?.summary === "string" ? boundText(entry.summary, 4000) : undefined,
				};
			}
			case "session_before_tree": {
				const prep = e.preparation as Record<string, unknown> | undefined;
				return {
					targetId: prep?.targetId ?? e.targetId,
					oldLeafId: prep?.oldLeafId,
				};
			}
			case "session_tree":
				return {
					newLeafId: e.newLeafId,
					oldLeafId: e.oldLeafId,
					fromExtension: e.fromExtension,
					hasSummaryEntry: Boolean(e.summaryEntry),
				};
			case "session_before_switch":
				return { reason: e.reason, targetSessionFile: e.targetSessionFile };
			case "session_switch":
				return { reason: e.reason, previousSessionFile: e.previousSessionFile };
			case "session_before_fork":
				return { entryId: e.entryId };
			case "session_fork":
				return { entryId: e.entryId, newSessionFile: e.newSessionFile ?? e.sessionFile };
			case "session_info_changed":
				return { name: e.name };
			case "session_shutdown":
				return { reason: e.reason, targetSessionFile: e.targetSessionFile };
			case "session_start":
				return { reason: e.reason };

			case "input": {
				const text = typeof e.text === "string" ? e.text : "";
				return {
					source: e.source,
					textLen: text.length,
					text: boundText(text, BUDGET.input),
					streamingBehavior: e.streamingBehavior,
					imageCount: Array.isArray(e.images) ? e.images.length : 0,
				};
			}

			case "turn_start":
				return { turnIndex: e.turnIndex, timestamp: e.timestamp };

			case "turn_end": {
				const msg = e.message as { usage?: PiUsage; stopReason?: string; role?: string } | undefined;
				const usage = msg?.usage ? fromPiUsage(msg.usage, "turn_end") : null;
				const toolResults = Array.isArray(e.toolResults)
					? (e.toolResults as unknown[]).map((tr) => {
							const t = tr as Record<string, unknown>;
							const text = contentText(t.content);
							return {
								toolCallId: t.toolCallId,
								toolName: t.toolName,
								isError: Boolean(t.isError),
								contentText: boundText(text, BUDGET.tool),
								contentLen: text.length,
							};
						})
					: [];
				return {
					turnIndex: e.turnIndex,
					stopReason: msg?.stopReason,
					message: messageSnapshot(e.message),
					toolResults,
					toolResultCount: toolResults.length,
					usage,
				};
			}

			case "tool_call":
				return {
					toolName: e.toolName,
					toolCallId: e.toolCallId,
					input: boundJson(e.input, BUDGET.args),
				};

			case "tool_result":
				return toolResultSnapshot(e);

			case "tool_execution_start":
				return {
					toolName: e.toolName,
					toolCallId: e.toolCallId,
					args: boundJson(e.args, BUDGET.args),
				};

			case "tool_execution_end": {
				const resultText = contentText(e.result) || safeStringify(e.result ?? "");
				return {
					toolName: e.toolName,
					toolCallId: e.toolCallId,
					isError: Boolean(e.isError),
					resultText: boundText(resultText, BUDGET.tool),
					resultLen: resultText.length,
					result: boundJson(e.result, BUDGET.tool),
				};
			}

			case "message_start":
				return {
					role: (e.message as { role?: string } | undefined)?.role,
					message: messageSnapshot(e.message),
				};

			case "message_end": {
				const msg = e.message as { usage?: PiUsage; stopReason?: string } | undefined;
				const usage = msg?.usage ? fromPiUsage(msg.usage, "message_end") : null;
				return {
					stopReason: msg?.stopReason,
					usage,
					message: messageSnapshot(e.message),
				};
			}

			case "before_provider_request": {
				const payload = e.payload as Record<string, unknown> | undefined;
				const messages = Array.isArray(payload?.messages) ? payload.messages : undefined;
				return {
					model: typeof payload?.model === "string" ? payload.model : undefined,
					messageCount: messages?.length,
					// full payload lives in provider-payload.jsonl + HTTP body; keep shape summary here
					payloadKeys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 40) : undefined,
				};
			}

			case "after_provider_response":
				return { status: e.status };

			case "context": {
				const messages = Array.isArray(e.messages) ? (e.messages as unknown[]) : [];
				const roleCounts: Record<string, number> = {};
				for (const m of messages) {
					const role = String((m as { role?: string })?.role ?? "unknown");
					roleCounts[role] = (roleCounts[role] ?? 0) + 1;
				}
				const tail = messages.slice(-12).map((m) => {
					const snap = messageSnapshot(m);
					return {
						role: String(snap?.role ?? "unknown"),
						textPreview: boundText(String(snap?.text ?? ""), 400),
						textLen: snap?.textLen,
						toolName: snap?.toolName,
					};
				});
				return {
					messageCount: messages.length,
					roleCounts,
					tail,
					systemPromptLen:
						typeof e.systemPrompt === "string" ? e.systemPrompt.length : undefined,
					systemPromptPreview:
						typeof e.systemPrompt === "string"
							? boundText(e.systemPrompt, 2000)
							: undefined,
				};
			}

			case "agent_end": {
				const messages = Array.isArray(e.messages) ? (e.messages as unknown[]) : [];
				return {
					messageCount: messages.length,
					messages: messages.slice(-20).map((m) => messageSnapshot(m)),
				};
			}

			case "model_select": {
				const model = e.model as { provider?: string; id?: string } | undefined;
				const prev = e.previousModel as { provider?: string; id?: string } | undefined;
				return {
					provider: model?.provider,
					model: model?.id,
					previous: prev ? `${prev.provider}/${prev.id}` : undefined,
					source: e.source,
				};
			}

			default:
				return undefined;
		}
	} catch {
		return undefined;
	}
}

function writeLlmUsageFromMessage(eventName: string, event: unknown, ctx: ExtensionContext): void {
	if (eventName !== "message_end" && eventName !== "turn_end") return;
	const e = event as Record<string, unknown>;
	const msg = e.message as { role?: string; usage?: PiUsage } | undefined;
	if (!msg || msg.role !== "assistant" || !msg.usage) return;

	const model = ctx.model;
	const metrics = fromPiUsage(
		msg.usage,
		eventName === "turn_end" ? "turn_end" : "message_end",
		model?.provider,
		model?.id,
	);
	if (!metrics) return;

	const exchangeId = getActiveExchangeId() ?? getMostRecentExchangeId();
	writeTrace({
		ts: new Date().toISOString(),
		kind: "llm_usage",
		id: exchangeId ?? evtId(),
		usage: metrics,
		summary: `usage in ${metrics.input} out ${metrics.output} cache ${(metrics.cacheHitRate * 100).toFixed(0)}% $${metrics.costTotal.toFixed(4)}`,
	});
}

/** Active turn for correlation; null outside turns. */
let activeTurnIndex: number | null = null;

function emit(eventName: string, event: unknown, ctx: ExtensionContext): void {
	if (!isTraceEnabled()) return;
	applySessionFromCtx(ctx);

	const e = event as Record<string, unknown>;
	if (eventName === "turn_start" && typeof e.turnIndex === "number") {
		activeTurnIndex = e.turnIndex;
	}

	const exchangeId = getActiveExchangeId() ?? getMostRecentExchangeId() ?? undefined;
	const turnIndex =
		typeof e.turnIndex === "number"
			? e.turnIndex
			: activeTurnIndex != null
				? activeTurnIndex
				: undefined;

	const detail = compactDetail(eventName, event);
	writeTrace({
		ts: new Date().toISOString(),
		kind: "pi_event",
		id: evtId(),
		eventName,
		summary: summarize(eventName, event),
		detail,
		exchangeId,
		turnIndex,
	});
	writeLlmUsageFromMessage(eventName, event, ctx);

	if (eventName === "turn_end") {
		// keep turnIndex on the end event itself; clear after
		activeTurnIndex = null;
	}
	if (eventName === "agent_end" || eventName === "session_shutdown") {
		activeTurnIndex = null;
	}
}

const PI_EVENTS = [
	"session_start",
	"session_shutdown",
	...SESSION_STRUCTURE_EVENTS,
	"input",
	"before_agent_start",
	"agent_start",
	"agent_end",
	"turn_start",
	"turn_end",
	"context",
	"before_provider_request",
	"after_provider_response",
	"tool_call",
	"tool_result",
	"tool_execution_start",
	"tool_execution_end",
	"message_start",
	"message_end",
	"model_select",
] as const;

let piEventsAttached = false;

/** Register Pi lifecycle hooks once (first /trace on). Pi has no unregister; emit() no-ops when trace off. */
export function attachPiEventTrace(pi: ExtensionAPI): void {
	if (piEventsAttached) return;
	piEventsAttached = true;
	for (const name of PI_EVENTS) {
		pi.on(name, (event, ctx) => {
			emit(name, event, ctx);
		});
	}
}

export function detachPiEventTrace(): void {
	/* handlers stay registered; isTraceEnabled() gates emit() */
	activeTurnIndex = null;
}

export function isSessionStructureEvent(eventName: string): boolean {
	return (SESSION_STRUCTURE_EVENTS as readonly string[]).includes(eventName);
}

/** Test helpers */
export const __test = {
	compactDetail,
	messageSnapshot,
	boundText,
	BUDGET,
};
