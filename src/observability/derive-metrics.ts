import type { TraceRecord } from "../logger.js";
import type { ObservationMetrics, ObservationRollup, ScoreEvent, TraceMetrics } from "./types.js";
import { aggregateScores } from "./score-aggregates.js";
import type { UsageMetrics } from "../usage-metrics.js";

export type ExchangeSlice = {
	id: string;
	requestTs?: string;
	responseTs?: string;
	firstSseTs?: string;
	lastSseTs?: string;
	usage: UsageMetrics | null;
	sseLineCount: number;
	errorCount: number;
};

export function foldExchangeFromRecords(records: TraceRecord[]): Map<string, ExchangeSlice> {
	const map = new Map<string, ExchangeSlice>();
	for (const rec of records) {
		if (!rec.id || rec.id === "session") continue;
		if (rec.kind === "pi_event") continue;
		let ex = map.get(rec.id);
		if (!ex) {
			ex = { id: rec.id, usage: null, sseLineCount: 0, errorCount: 0 };
			map.set(rec.id, ex);
		}
		if (rec.kind === "request") ex.requestTs = rec.ts;
		if (rec.kind === "response_meta") ex.responseTs = rec.ts;
		if (rec.kind === "sse_line") {
			ex.sseLineCount += 1;
			if (!ex.firstSseTs) ex.firstSseTs = rec.ts;
			ex.lastSseTs = rec.ts;
		}
		if (rec.kind === "stream_result" && rec.stream) {
			ex.sseLineCount = Math.max(ex.sseLineCount, rec.stream.eventCount);
			ex.firstSseTs = rec.stream.firstEventTs ?? ex.firstSseTs;
			ex.lastSseTs = rec.stream.lastEventTs ?? rec.ts;
		}
		if (rec.kind === "error") ex.errorCount += 1;
		if (rec.kind === "llm_usage" && rec.usage) ex.usage = rec.usage;
	}
	return map;
}

function msBetween(a?: string, b?: string): number | undefined {
	if (!a || !b) return undefined;
	const t0 = Date.parse(a);
	const t1 = Date.parse(b);
	if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return undefined;
	return t1 - t0;
}

export function deriveGenerationMetrics(ex: ExchangeSlice): ObservationMetrics | null {
	const u = ex.usage;
	if (!u) return null;
	const latencyMs = msBetween(ex.requestTs, ex.lastSseTs ?? ex.responseTs);
	const timeToFirstTokenMs = msBetween(ex.requestTs, ex.firstSseTs);
	const streamingLatencyMs =
		ex.firstSseTs && ex.lastSseTs ? msBetween(ex.firstSseTs, ex.lastSseTs) : undefined;
	let outputTokensPerSecond: number | undefined;
	let tokensPerSecond: number | undefined;
	if (latencyMs && latencyMs > 0) {
		tokensPerSecond = u.totalTokens / (latencyMs / 1000);
		const genMs = ex.firstSseTs && ex.lastSseTs ? msBetween(ex.firstSseTs, ex.lastSseTs) : undefined;
		if (genMs && genMs > 0) outputTokensPerSecond = u.output / (genMs / 1000);
	}
	return {
		latencyMs,
		streamingLatencyMs,
		timeToFirstTokenMs,
		inputTokens: u.input,
		outputTokens: u.output,
		totalTokens: u.totalTokens,
		outputTokensPerSecond,
		tokensPerSecond,
		inputCost: u.costInput,
		outputCost: u.costOutput,
		totalCost: u.costTotal,
		cacheReadTokens: u.cacheRead,
		cacheWriteTokens: u.cacheWrite,
		cacheHitRate: u.cacheHitRate,
	};
}

export function rollupTraceMetrics(records: TraceRecord[]): TraceMetrics {
	const exchanges = foldExchangeFromRecords(records);
	let inputTokens = 0, outputTokens = 0, totalTokens = 0;
	let inputCost = 0, outputCost = 0, totalCost = 0;
	let generationCount = 0, errorCount = 0;
	let minStart: string | undefined, maxEnd: string | undefined;
	for (const ex of exchanges.values()) {
		if (!ex.requestTs) continue;
		if (ex.usage) {
			generationCount += 1;
			inputTokens += ex.usage.input;
			outputTokens += ex.usage.output;
			totalTokens += ex.usage.totalTokens;
			inputCost += ex.usage.costInput;
			outputCost += ex.usage.costOutput;
			totalCost += ex.usage.costTotal;
		}
		errorCount += ex.errorCount;
		if (ex.requestTs && (!minStart || ex.requestTs < minStart)) minStart = ex.requestTs;
		const end = ex.lastSseTs ?? ex.responseTs;
		if (end && (!maxEnd || end > maxEnd)) maxEnd = end;
	}
	let spanCount = 0, eventCount = 0;
	for (const rec of records) {
		if (rec.kind !== "pi_event") continue;
		eventCount += 1;
		if (rec.eventName?.startsWith("tool_")) spanCount += 1;
		if (rec.eventName === "tool_result" && rec.detail && (rec.detail as { isError?: boolean }).isError) errorCount += 1;
	}
	return {
		latencyMs: msBetween(minStart, maxEnd),
		inputTokens, outputTokens, totalTokens, inputCost, outputCost, totalCost,
		generationCount, spanCount, eventCount, errorCount,
		warningCount: 0, defaultCount: 0, debugCount: 0,
	};
}


export function rollupObservationMetrics(exchanges: Iterable<ExchangeSlice>): ObservationRollup | null {
	let count = 0;
	const acc: ObservationMetrics = {
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		inputCost: 0,
		outputCost: 0,
		totalCost: 0,
	};
	let latSum = 0, latN = 0, ttftSum = 0, ttftN = 0, streamSum = 0, streamN = 0;
	let tpsSum = 0, tpsN = 0, outTpsSum = 0, outTpsN = 0;
	for (const ex of exchanges) {
		const m = deriveGenerationMetrics(ex);
		if (!m) continue;
		count += 1;
		acc.inputTokens += m.inputTokens;
		acc.outputTokens += m.outputTokens;
		acc.totalTokens += m.totalTokens;
		acc.inputCost += m.inputCost;
		acc.outputCost += m.outputCost;
		acc.totalCost += m.totalCost;
		if (m.latencyMs != null) { latSum += m.latencyMs; latN += 1; }
		if (m.timeToFirstTokenMs != null) { ttftSum += m.timeToFirstTokenMs; ttftN += 1; }
		if (m.streamingLatencyMs != null) { streamSum += m.streamingLatencyMs; streamN += 1; }
		if (m.tokensPerSecond != null) { tpsSum += m.tokensPerSecond; tpsN += 1; }
		if (m.outputTokensPerSecond != null) { outTpsSum += m.outputTokensPerSecond; outTpsN += 1; }
	}
	if (count === 0) return null;
	if (latN) acc.latencyMs = latSum / latN;
	if (ttftN) acc.timeToFirstTokenMs = ttftSum / ttftN;
	if (streamN) acc.streamingLatencyMs = streamSum / streamN;
	if (tpsN) acc.tokensPerSecond = tpsSum / tpsN;
	if (outTpsN) acc.outputTokensPerSecond = outTpsSum / outTpsN;
	return { count, metrics: acc };
}

export function rollupTraceMetricsWithScores(records: TraceRecord[], scores: ScoreEvent[]): TraceMetrics {
	const base = rollupTraceMetrics(records);
	const exchanges = foldExchangeFromRecords(records);
	const obs = rollupObservationMetrics(exchanges.values());
	let warningCount = 0, defaultCount = 0, debugCount = 0;
	for (const rec of records) {
		if (rec.kind !== "pi_event") continue;
		const level = (rec.detail as { level?: string } | undefined)?.level;
		if (rec.eventName?.includes("warn") || level === "WARNING") warningCount += 1;
		else if (level === "DEBUG") debugCount += 1;
		else defaultCount += 1;
	}
	return {
		...base,
		warningCount,
		defaultCount,
		debugCount,
		observationCount: obs?.count ?? base.generationCount,
		scores: aggregateScores(scores),
	};
}
