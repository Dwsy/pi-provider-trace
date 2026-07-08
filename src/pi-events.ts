import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { applySessionFromCtx } from "./session-context.js";
import { getActiveExchangeId } from "./http-exchange-context.js";
import { isTraceEnabled, writeTrace } from "./logger.js";
import { fromPiUsage, type PiUsage } from "./usage-metrics.js";

function evtId(): string {
	return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function trunc(s: string, max = 120): string {
	if (s.length <= max) return s;
	return s.slice(0, max) + "…";
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
			const prep = e.preparation as { tokensBefore?: number; firstKeptEntryId?: string } | undefined;
			const tok = prep?.tokensBefore != null ? ` ~${prep.tokensBefore} tok` : "";
			return `before_compact · ${String(e.reason ?? "manual")}${tok}`;
		}
		case "session_compact": {
			const entry = e.compactionEntry as { summary?: string; tokensBefore?: number } | undefined;
			const sum = entry?.summary ? trunc(entry.summary.replace(/\s+/g, " "), 60) : "";
			return `compact done · ${String(e.reason ?? "?")} retry=${String(e.willRetry ?? false)} ${sum}`;
		}
		case "session_before_tree": {
			const prep = e.preparation as { targetId?: string; oldLeafId?: string } | undefined;
			return `before_tree · target ${String(prep?.targetId ?? e.targetId ?? "?").slice(0, 12)}`;
		}
		case "session_tree": {
			return `tree · leaf ${String(e.oldLeafId ?? "?").slice(0, 8)} → ${String(e.newLeafId ?? "?").slice(0, 8)} ext=${String(e.fromExtension ?? false)}`;
		}
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
			return `tool_exec end · ${String(e.toolName ?? "?")}`;
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
			return `message_end · ${m?.role ?? "?"} · ${m?.stopReason ?? ""}`;
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
					summaryPreview: typeof entry?.summary === "string" ? trunc(entry.summary, 500) : undefined,
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
			case "tool_call":
				return { toolName: e.toolName, toolCallId: e.toolCallId };
			case "tool_result":
				return { toolName: e.toolName, isError: e.isError };
			case "turn_end": {
				const msg = e.message as { usage?: PiUsage; stopReason?: string } | undefined;
				const usage = msg?.usage ? fromPiUsage(msg.usage, "turn_end") : null;
				return {
					turnIndex: e.turnIndex,
					toolResults: Array.isArray(e.toolResults) ? e.toolResults.length : 0,
					usage,
				};
			}
			case "message_end": {
				const msg = e.message as { usage?: PiUsage; stopReason?: string } | undefined;
				const usage = msg?.usage ? fromPiUsage(msg.usage, "message_end") : null;
				return { stopReason: msg?.stopReason, usage };
			}
			case "after_provider_response":
				return { status: e.status };
			case "input": {
				const text = typeof e.text === "string" ? e.text : "";
				return { source: e.source, textLen: text.length, text: text.slice(0, 2000) };
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
	const metrics = fromPiUsage(msg.usage, eventName === "turn_end" ? "turn_end" : "message_end", model?.provider, model?.id);
	if (!metrics) return;

	const exchangeId = getActiveExchangeId();
	writeTrace({
		ts: new Date().toISOString(),
		kind: "llm_usage",
		id: exchangeId ?? evtId(),
		usage: metrics,
		summary: `usage in ${metrics.input} out ${metrics.output} cache ${(metrics.cacheHitRate * 100).toFixed(0)}% $${metrics.costTotal.toFixed(4)}`,
	});
}

function emit(eventName: string, event: unknown, ctx: ExtensionContext): void {
	if (!isTraceEnabled()) return;
	applySessionFromCtx(ctx);
	writeTrace({
		ts: new Date().toISOString(),
		kind: "pi_event",
		id: evtId(),
		eventName,
		summary: summarize(eventName, event),
		detail: compactDetail(eventName, event),
	});
	writeLlmUsageFromMessage(eventName, event, ctx);
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
		pi.on(name, async (event, ctx) => {
			emit(name, event, ctx);
		});
	}
}

export function detachPiEventTrace(): void {
	/* handlers stay registered; isTraceEnabled() gates emit() */
}

export function isSessionStructureEvent(eventName: string): boolean {
	return (SESSION_STRUCTURE_EVENTS as readonly string[]).includes(eventName);
}