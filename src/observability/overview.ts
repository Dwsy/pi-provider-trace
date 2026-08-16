import { join } from "node:path";
import type { TraceRecord } from "../logger.js";
import { listAllSessions } from "../session-registry.js";
import type { UsageMetrics } from "../usage-metrics.js";
import {
	deriveGenerationMetrics,
	foldExchangeFromRecords,
	type ExchangeSlice,
} from "./derive-metrics.js";
import { compactLegacySseRecords, readSessionLogTail } from "./read-session-log.js";
import type { ObservationMetrics } from "./types.js";

export const OVERVIEW_WINDOWS = ["24h", "7d", "30d", "all"] as const;
export type OverviewWindow = (typeof OVERVIEW_WINDOWS)[number];

export const OVERVIEW_DEFAULT_LIMIT = 50;
export const OVERVIEW_MAX_LIMIT = 500;

/** Grouping label for exchanges whose provider or model cannot be resolved. */
export const OVERVIEW_UNKNOWN = "unknown";

const WINDOW_MS: Record<Exclude<OverviewWindow, "all">, number> = {
	"24h": 24 * 60 * 60 * 1000,
	"7d": 7 * 24 * 60 * 60 * 1000,
	"30d": 30 * 24 * 60 * 60 * 1000,
};

/** One stray far-past timestamp must not turn gap filling into millions of rows. */
const MAX_TIMELINE_BUCKETS = 1000;

export type OverviewTotals = {
	generations: number;
	exchanges: number;
	errors: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	totalCost: number;
	cacheHitRate: number;
	avgTtftMs: number | null;
	p50TtftMs: number | null;
	p95TtftMs: number | null;
	avgLatencyMs: number | null;
	p95LatencyMs: number | null;
	avgOutputTps: number | null;
};

export type OverviewSession = {
	key: string;
	label: string;
	lastTs: string;
	generations: number;
	errors: number;
	totalTokens: number;
	totalCost: number;
	avgTtftMs: number | null;
	avgLatencyMs: number | null;
	models: string[];
};

export type OverviewModel = {
	key: string;
	provider: string;
	model: string;
	generations: number;
	errors: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	totalTokens: number;
	totalCost: number;
	avgTtftMs: number | null;
	p95TtftMs: number | null;
	avgOutputTps: number | null;
	sessions: number;
};

export type OverviewProvider = {
	provider: string;
	generations: number;
	errors: number;
	totalTokens: number;
	totalCost: number;
	avgTtftMs: number | null;
	sessions: number;
	models: number;
};

export type OverviewBucket = {
	bucket: string;
	generations: number;
	errors: number;
	totalTokens: number;
	totalCost: number;
	avgTtftMs: number | null;
};

export type OverviewScan = {
	sessions: number;
	included: number;
	bytes: number;
	truncated: boolean;
	durationMs: number;
};

export type OverviewResponse = {
	generatedAt: string;
	window: OverviewWindow;
	windowStart: string | null;
	scanned: OverviewScan;
	totals: OverviewTotals;
	sessions: OverviewSession[];
	models: OverviewModel[];
	providers: OverviewProvider[];
	timeline: OverviewBucket[];
};

export type OverviewSessionInput = {
	key: string;
	label: string;
	records: readonly TraceRecord[];
};

export type BuildOverviewInput = {
	sessions: readonly OverviewSessionInput[];
	window: OverviewWindow;
	limit: number;
	now: Date;
	/** Only the disk reader knows real byte counts; an in-memory build reports none. */
	scan?: Partial<Omit<OverviewScan, "included">>;
};

export function isOverviewWindow(value: string): value is OverviewWindow {
	return (OVERVIEW_WINDOWS as readonly string[]).includes(value);
}

/** Clamps to the documented ceiling; null means the value is unusable and the caller answers 400. */
export function parseOverviewLimit(raw: string | null): number | null {
	if (raw == null || raw.trim() === "") return OVERVIEW_DEFAULT_LIMIT;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1) return null;
	return Math.min(value, OVERVIEW_MAX_LIMIT);
}

type BucketUnit = "hour" | "day";

type ExchangeContext = { ts: string; url?: string };

type ExchangeSample = {
	ts: string;
	hasRequest: boolean;
	errors: number;
	provider: string;
	model: string;
	modelKey: string;
	metrics: ObservationMetrics | null;
};

type Accumulator = {
	generations: number;
	exchanges: number;
	errors: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	totalCost: number;
	ttft: number[];
	latency: number[];
	outputTps: number[];
};

type ModelBucket = { provider: string; model: string; acc: Accumulator; sessions: Set<string> };
type ProviderBucket = { acc: Accumulator; sessions: Set<string>; models: Set<string> };

function createAccumulator(): Accumulator {
	return {
		generations: 0,
		exchanges: 0,
		errors: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		totalCost: 0,
		ttft: [],
		latency: [],
		outputTps: [],
	};
}

function accumulate(acc: Accumulator, sample: ExchangeSample): void {
	if (sample.hasRequest) acc.exchanges += 1;
	acc.errors += sample.errors;
	const metrics = sample.metrics;
	if (!metrics) return;
	acc.generations += 1;
	acc.inputTokens += metrics.inputTokens;
	acc.outputTokens += metrics.outputTokens;
	acc.cacheReadTokens += metrics.cacheReadTokens ?? 0;
	acc.cacheWriteTokens += metrics.cacheWriteTokens ?? 0;
	acc.totalTokens += metrics.totalTokens;
	acc.totalCost += metrics.totalCost;
	if (metrics.timeToFirstTokenMs != null) acc.ttft.push(metrics.timeToFirstTokenMs);
	if (metrics.latencyMs != null) acc.latency.push(metrics.latencyMs);
	if (metrics.outputTokensPerSecond != null) acc.outputTps.push(metrics.outputTokensPerSecond);
}

function mean(sample: readonly number[]): number | null {
	if (!sample.length) return null;
	let sum = 0;
	for (const value of sample) sum += value;
	return sum / sample.length;
}

/** Nearest-rank percentile. An empty sample is null so the UI can say "never measured". */
function percentile(sample: readonly number[], p: number): number | null {
	if (!sample.length) return null;
	const sorted = [...sample].sort((a, b) => a - b);
	const rank = Math.ceil((p / 100) * sorted.length);
	return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function cacheHitRateOf(acc: Accumulator): number {
	const prompt = acc.inputTokens + acc.cacheReadTokens;
	if (prompt <= 0) return 0;
	return acc.cacheReadTokens / prompt;
}

function bucketStart(ts: string, unit: BucketUnit): string {
	const date = new Date(ts);
	if (unit === "hour") date.setUTCMinutes(0, 0, 0);
	else date.setUTCHours(0, 0, 0, 0);
	return date.toISOString();
}

function shiftBucket(iso: string, unit: BucketUnit, steps: number): string {
	const date = new Date(iso);
	if (unit === "hour") date.setUTCHours(date.getUTCHours() + steps);
	else date.setUTCDate(date.getUTCDate() + steps);
	return date.toISOString();
}

/** Ascending and gap-filled; drops the oldest rows first when the span exceeds the cap. */
function bucketRange(first: string, last: string, unit: BucketUnit): string[] {
	const buckets: string[] = [];
	let cursor = last;
	while (cursor >= first && buckets.length < MAX_TIMELINE_BUCKETS) {
		buckets.push(cursor);
		cursor = shiftBucket(cursor, unit, -1);
	}
	return buckets.reverse();
}

function newestRecordTs(records: readonly TraceRecord[]): string | null {
	let newest: string | null = null;
	for (const record of records) {
		if (!record.ts) continue;
		if (!newest || record.ts > newest) newest = record.ts;
	}
	return newest;
}

function hostFromUrl(url?: string): string | undefined {
	if (!url) return undefined;
	try {
		return new URL(url).host || undefined;
	} catch {
		return undefined;
	}
}

/** The fold keeps only phase timestamps, but model identity also needs the exchange URL. */
function collectExchangeContext(records: readonly TraceRecord[]): Map<string, ExchangeContext> {
	const contexts = new Map<string, ExchangeContext>();
	for (const record of records) {
		if (!record.id || record.id === "session") continue;
		if (record.kind === "pi_event") continue;
		const known = contexts.get(record.id);
		if (!known) {
			contexts.set(record.id, { ts: record.ts, url: record.url });
			continue;
		}
		if (record.ts && record.ts < known.ts) known.ts = record.ts;
		if (record.url && (!known.url || record.kind === "request")) known.url = record.url;
	}
	return contexts;
}

function resolveModelIdentity(
	usage: UsageMetrics | null,
	url: string | undefined,
): { provider: string; model: string } {
	return {
		provider: usage?.provider?.trim() || hostFromUrl(url) || OVERVIEW_UNKNOWN,
		model: usage?.model?.trim() || OVERVIEW_UNKNOWN,
	};
}

function toSample(exchange: ExchangeSlice, context: ExchangeContext | undefined): ExchangeSample | null {
	const ts = exchange.requestTs ?? context?.ts;
	if (!ts || !Number.isFinite(Date.parse(ts))) return null;
	const { provider, model } = resolveModelIdentity(exchange.usage, context?.url);
	return {
		ts,
		hasRequest: Boolean(exchange.requestTs),
		errors: exchange.errorCount,
		provider,
		model,
		modelKey: `${provider}/${model}`,
		metrics: deriveGenerationMetrics(exchange),
	};
}

/**
 * Folds already-loaded session records into the cross-session overview.
 * Pure over its inputs so the aggregation is testable without touching disk.
 */
export function buildOverview(input: BuildOverviewInput): OverviewResponse {
	const { sessions, window, limit, now } = input;
	const unit: BucketUnit = window === "24h" ? "hour" : "day";
	const windowStart =
		window === "all" ? null : new Date(now.getTime() - WINDOW_MS[window]).toISOString();

	const totals = createAccumulator();
	const models = new Map<string, ModelBucket>();
	const providers = new Map<string, ProviderBucket>();
	const timeline = new Map<string, Accumulator>();
	const rows: OverviewSession[] = [];
	let included = 0;

	for (const session of sessions) {
		const lastTs = newestRecordTs(session.records);
		if (!lastTs) continue;
		if (windowStart && lastTs < windowStart) continue;
		included += 1;

		const records = compactLegacySseRecords([...session.records]);
		const contexts = collectExchangeContext(records);
		const samples: ExchangeSample[] = [];
		for (const exchange of foldExchangeFromRecords(records).values()) {
			const sample = toSample(exchange, contexts.get(exchange.id));
			if (!sample) continue;
			if (windowStart && sample.ts < windowStart) continue;
			samples.push(sample);
		}
		// First-seen model order, and stable timeline attribution, both follow exchange time.
		samples.sort((a, b) => a.ts.localeCompare(b.ts));

		const sessionAcc = createAccumulator();
		const sessionModels: string[] = [];
		for (const sample of samples) {
			accumulate(totals, sample);
			accumulate(sessionAcc, sample);
			if (!sessionModels.includes(sample.modelKey)) sessionModels.push(sample.modelKey);

			let model = models.get(sample.modelKey);
			if (!model) {
				model = {
					provider: sample.provider,
					model: sample.model,
					acc: createAccumulator(),
					sessions: new Set(),
				};
				models.set(sample.modelKey, model);
			}
			accumulate(model.acc, sample);
			model.sessions.add(session.key);

			let provider = providers.get(sample.provider);
			if (!provider) {
				provider = { acc: createAccumulator(), sessions: new Set(), models: new Set() };
				providers.set(sample.provider, provider);
			}
			accumulate(provider.acc, sample);
			provider.sessions.add(session.key);
			provider.models.add(sample.modelKey);

			const bucket = bucketStart(sample.ts, unit);
			let bucketAcc = timeline.get(bucket);
			if (!bucketAcc) {
				bucketAcc = createAccumulator();
				timeline.set(bucket, bucketAcc);
			}
			accumulate(bucketAcc, sample);
		}

		rows.push({
			key: session.key,
			label: session.label,
			lastTs,
			generations: sessionAcc.generations,
			errors: sessionAcc.errors,
			totalTokens: sessionAcc.totalTokens,
			totalCost: sessionAcc.totalCost,
			avgTtftMs: mean(sessionAcc.ttft),
			avgLatencyMs: mean(sessionAcc.latency),
			models: sessionModels,
		});
	}

	rows.sort((a, b) => b.lastTs.localeCompare(a.lastTs) || a.key.localeCompare(b.key));

	const modelRows: OverviewModel[] = [...models.entries()]
		.map(([key, bucket]) => ({
			key,
			provider: bucket.provider,
			model: bucket.model,
			generations: bucket.acc.generations,
			errors: bucket.acc.errors,
			inputTokens: bucket.acc.inputTokens,
			outputTokens: bucket.acc.outputTokens,
			cacheReadTokens: bucket.acc.cacheReadTokens,
			totalTokens: bucket.acc.totalTokens,
			totalCost: bucket.acc.totalCost,
			avgTtftMs: mean(bucket.acc.ttft),
			p95TtftMs: percentile(bucket.acc.ttft, 95),
			avgOutputTps: mean(bucket.acc.outputTps),
			sessions: bucket.sessions.size,
		}))
		.sort(
			(a, b) =>
				b.totalCost - a.totalCost || b.totalTokens - a.totalTokens || a.key.localeCompare(b.key),
		);

	const providerRows: OverviewProvider[] = [...providers.entries()]
		.map(([provider, bucket]) => ({
			provider,
			generations: bucket.acc.generations,
			errors: bucket.acc.errors,
			totalTokens: bucket.acc.totalTokens,
			totalCost: bucket.acc.totalCost,
			avgTtftMs: mean(bucket.acc.ttft),
			sessions: bucket.sessions.size,
			models: bucket.models.size,
		}))
		.sort(
			(a, b) =>
				b.totalCost - a.totalCost ||
				b.totalTokens - a.totalTokens ||
				a.provider.localeCompare(b.provider),
		);

	return {
		generatedAt: now.toISOString(),
		window,
		windowStart,
		scanned: {
			sessions: input.scan?.sessions ?? sessions.length,
			included,
			bytes: input.scan?.bytes ?? 0,
			truncated: input.scan?.truncated ?? false,
			durationMs: input.scan?.durationMs ?? 0,
		},
		totals: {
			generations: totals.generations,
			exchanges: totals.exchanges,
			errors: totals.errors,
			inputTokens: totals.inputTokens,
			outputTokens: totals.outputTokens,
			cacheReadTokens: totals.cacheReadTokens,
			cacheWriteTokens: totals.cacheWriteTokens,
			totalTokens: totals.totalTokens,
			totalCost: totals.totalCost,
			cacheHitRate: cacheHitRateOf(totals),
			avgTtftMs: mean(totals.ttft),
			p50TtftMs: percentile(totals.ttft, 50),
			p95TtftMs: percentile(totals.ttft, 95),
			avgLatencyMs: mean(totals.latency),
			p95LatencyMs: percentile(totals.latency, 95),
			avgOutputTps: mean(totals.outputTps),
		},
		sessions: rows.slice(0, limit),
		models: modelRows,
		providers: providerRows,
		timeline: buildTimeline(timeline, windowStart, now, unit),
	};
}

function buildTimeline(
	timeline: Map<string, Accumulator>,
	windowStart: string | null,
	now: Date,
	unit: BucketUnit,
): OverviewBucket[] {
	const observed = [...timeline.keys()].sort();
	const observedFirst = observed[0];
	const observedLast = observed[observed.length - 1];
	// A fixed window always spans the whole window; "all" spans the data it actually has.
	const first = windowStart ? bucketStart(windowStart, unit) : observedFirst;
	const nowBucket = bucketStart(now.toISOString(), unit);
	const last = windowStart
		? observedLast && observedLast > nowBucket
			? observedLast
			: nowBucket
		: observedLast;
	if (!first || !last) return [];

	return bucketRange(first, last, unit).map((bucket) => {
		const acc = timeline.get(bucket);
		return {
			bucket,
			generations: acc?.generations ?? 0,
			errors: acc?.errors ?? 0,
			totalTokens: acc?.totalTokens ?? 0,
			totalCost: acc?.totalCost ?? 0,
			avgTtftMs: acc ? mean(acc.ttft) : null,
		};
	});
}

export type CollectOverviewOptions = {
	window: OverviewWindow;
	limit: number;
	now?: Date;
};

/** Reads every session log under `logDir` within the window and folds it into one overview. */
export function collectOverview(logDir: string, options: CollectOverviewOptions): OverviewResponse {
	const startedAt = Date.now();
	const now = options.now ?? new Date();
	const windowStart =
		options.window === "all"
			? null
			: new Date(now.getTime() - WINDOW_MS[options.window]).toISOString();

	const entries = listAllSessions(logDir);
	const sessions: OverviewSessionInput[] = [];
	let bytes = 0;
	let truncated = false;

	for (const entry of entries) {
		// Log mtime is an upper bound on record time, so an older file holds no in-window record.
		if (windowStart && entry.lastTs && entry.lastTs < windowStart) continue;
		try {
			const tail = readSessionLogTail(join(logDir, "sessions", entry.key, "http-sse.jsonl"));
			bytes += tail.bytes;
			truncated = truncated || tail.truncated;
			sessions.push({ key: entry.key, label: entry.label, records: tail.records });
		} catch {
			// One unreadable log is skipped; it still counts as scanned.
		}
	}

	return buildOverview({
		sessions,
		window: options.window,
		limit: options.limit,
		now,
		scan: { sessions: entries.length, bytes, truncated, durationMs: Date.now() - startedAt },
	});
}
