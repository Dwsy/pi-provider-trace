import type { TraceRecord } from "../logger.js";
import type { ObservationEvent } from "./types.js";

export function isObservationDualWriteEnabled(): boolean {
	const v = process.env.PI_PROVIDER_TRACE_WRITE_OBSERVATION?.trim().toLowerCase();
	return v === "1" || v === "true" || v === "on";
}

export function observationFromLlmUsage(rec: TraceRecord): ObservationEvent | null {
	if (rec.kind !== "llm_usage" || !rec.usage || !rec.id) return null;
	const sessionKey = rec.sessionKey ?? "unknown";
	return {
		schemaVersion: 1,
		kind: "observation",
		id: `obs-${rec.id}`,
		traceId: sessionKey,
		sessionKey,
		observationType: "generation",
		name: "llm_generation",
		startTime: rec.ts,
		endTime: rec.ts,
		level: "DEFAULT",
		provider: rec.usage.provider,
		model: rec.usage.model,
		metrics: {
			inputTokens: rec.usage.input,
			outputTokens: rec.usage.output,
			totalTokens: rec.usage.totalTokens,
			inputCost: rec.usage.costInput,
			outputCost: rec.usage.costOutput,
			totalCost: rec.usage.costTotal,
			cacheReadTokens: rec.usage.cacheRead,
			cacheWriteTokens: rec.usage.cacheWrite,
			cacheHitRate: rec.usage.cacheHitRate,
		},
		metadata: { sourceUsage: rec.usage.source, exchangeId: rec.id },
	};
}

export function observationTraceLine(rec: TraceRecord): TraceRecord | null {
	const obs = observationFromLlmUsage(rec);
	if (!obs) return null;
	return {
		ts: rec.ts,
		kind: "observation",
		id: obs.id,
		sessionKey: rec.sessionKey,
		sessionLabel: rec.sessionLabel,
		summary: `observation generation ${obs.model ?? ""}`.trim(),
		detail: obs as unknown as Record<string, unknown>,
	};
}
