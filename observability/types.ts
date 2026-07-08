/**
 * Langfuse-aligned observability contracts.
 */
export type ObservationKind = "generation" | "span" | "event";
export type LogLevel = "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";
export type ObservationMetrics = {
	latencyMs?: number;
	streamingLatencyMs?: number;
	timeToFirstTokenMs?: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	outputTokensPerSecond?: number;
	tokensPerSecond?: number;
	inputCost: number;
	outputCost: number;
	totalCost: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	cacheHitRate?: number;
};
export type ScoreAggregates = {
	countScores: number;
	scoresNumericCount: number;
	scoresCategoricalCount: number;
	scoresAvg?: number;
	scoreCategories?: Record<string, number>;
};

export type TraceMetrics = {
	latencyMs?: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	inputCost: number;
	outputCost: number;
	totalCost: number;
	generationCount: number;
	spanCount: number;
	eventCount: number;
	errorCount: number;
	warningCount: number;
	defaultCount: number;
	debugCount: number;
	observationCount?: number;
	scores?: ScoreAggregates;
};

/** Observation-level rollup (generation count = exchanges with usage). */
export type ObservationRollup = {
	count: number;
	metrics: ObservationMetrics;
};
export type MediaRef = { type: "image" | "audio" | "file" | "video"; url?: string; mimeType?: string; previewRef?: string };
export type ObservationEvent = {
	schemaVersion: 1;
	kind: "observation";
	id: string;
	traceId: string;
	sessionKey: string;
	observationType: ObservationKind;
	name: string;
	startTime: string;
	endTime?: string;
	level: LogLevel;
	provider?: string;
	model?: string;
	metrics?: ObservationMetrics;
	media?: MediaRef[];
};
export type ScoreEvent = {
	schemaVersion: 1;
	kind: "score";
	id: string;
	traceId: string;
	name: string;
	value: number | string;
	dataType: "NUMERIC" | "CATEGORICAL" | "BOOLEAN";
	ts: string;
};
