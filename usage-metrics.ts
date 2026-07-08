/** Normalized LLM usage (pi-ai providers: anthropic, openai-responses, openai-completions, etc.) */

export type UsageMetrics = {
	provider?: string;
	model?: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	costTotal: number;
	costInput: number;
	costOutput: number;
	costCacheRead: number;
	costCacheWrite: number;
	/** cacheRead / (input + cacheRead), 0–1 */
	cacheHitRate: number;
	source: "sse" | "message_end" | "turn_end";
};

export type UsageCost = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	total?: number;
};

export type PiUsage = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: UsageCost;
};

function num(v: unknown): number {
	return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function cacheHitRate(input: number, cacheRead: number): number {
	const denom = input + cacheRead;
	if (denom <= 0) return 0;
	return cacheRead / denom;
}

export function fromPiUsage(
	usage: PiUsage | undefined,
	source: UsageMetrics["source"],
	provider?: string,
	model?: string,
): UsageMetrics | null {
	if (!usage) return null;
	const input = num(usage.input);
	const output = num(usage.output);
	const cacheRead = num(usage.cacheRead);
	const cacheWrite = num(usage.cacheWrite);
	const totalTokens = num(usage.totalTokens) || input + output + cacheRead + cacheWrite;
	const cost = usage.cost ?? {};
	const costInput = num(cost.input);
	const costOutput = num(cost.output);
	const costCacheRead = num(cost.cacheRead);
	const costCacheWrite = num(cost.cacheWrite);
	const costTotal = num(cost.total) || costInput + costOutput + costCacheRead + costCacheWrite;
	if (totalTokens === 0 && costTotal === 0) return null;
	return {
		provider,
		model,
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens,
		costTotal,
		costInput,
		costOutput,
		costCacheRead,
		costCacheWrite,
		cacheHitRate: cacheHitRate(input, cacheRead),
		source,
	};
}

/** Merge partial usage (SSE streams often update incrementally). */
export function mergeUsage(a: UsageMetrics, b: Partial<UsageMetrics>): UsageMetrics {
	const input = Math.max(a.input, num(b.input));
	const output = Math.max(a.output, num(b.output));
	const cacheRead = Math.max(a.cacheRead, num(b.cacheRead));
	const cacheWrite = Math.max(a.cacheWrite, num(b.cacheWrite));
	const totalTokens = Math.max(a.totalTokens, num(b.totalTokens)) || input + output + cacheRead + cacheWrite;
	const costInput = Math.max(a.costInput, num(b.costInput));
	const costOutput = Math.max(a.costOutput, num(b.costOutput));
	const costCacheRead = Math.max(a.costCacheRead, num(b.costCacheRead));
	const costCacheWrite = Math.max(a.costCacheWrite, num(b.costCacheWrite));
	const costTotal = Math.max(a.costTotal, num(b.costTotal)) || costInput + costOutput + costCacheRead + costCacheWrite;
	return {
		provider: b.provider ?? a.provider,
		model: b.model ?? a.model,
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens,
		costTotal,
		costInput,
		costOutput,
		costCacheRead,
		costCacheWrite,
		cacheHitRate: cacheHitRate(input, cacheRead),
		source: b.source ?? a.source,
	};
}

function emptyMetrics(source: UsageMetrics["source"]): UsageMetrics {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		costTotal: 0,
		costInput: 0,
		costOutput: 0,
		costCacheRead: 0,
		costCacheWrite: 0,
		cacheHitRate: 0,
		source,
	};
}

/** Extract usage delta from one parsed SSE JSON object (multi-provider). */
export function extractUsageFromSseJson(obj: unknown): Partial<UsageMetrics> | null {
	if (!obj || typeof obj !== "object") return null;
	const o = obj as Record<string, unknown>;

	// Anthropic stream events
	if (o.type === "message_start" && o.message && typeof o.message === "object") {
		const u = (o.message as { usage?: Record<string, unknown> }).usage;
		if (u) {
			return {
				input: num(u.input_tokens),
				output: num(u.output_tokens),
				cacheRead: num(u.cache_read_input_tokens),
				cacheWrite: num(u.cache_creation_input_tokens),
				source: "sse",
			};
		}
	}
	if (o.type === "message_delta" && o.usage && typeof o.usage === "object") {
		const u = o.usage as Record<string, unknown>;
		return {
			provider: "anthropic",
			output: num(u.output_tokens),
			cacheRead: num(u.cache_read_input_tokens),
			source: "sse",
		};
	}

	// OpenAI chat completions chunk
	const usage = o.usage as Record<string, unknown> | undefined;
	if (usage && (usage.prompt_tokens != null || usage.completion_tokens != null)) {
		const details = usage.prompt_tokens_details as Record<string, unknown> | undefined;
		const cached = details ? num(details.cached_tokens) : 0;
		const input = num(usage.prompt_tokens);
		return {
			provider: "openai",
			input,
			output: num(usage.completion_tokens),
			cacheRead: cached,
			totalTokens: num(usage.total_tokens),
			source: "sse",
		};
	}

	// OpenAI Responses API
	if (o.type === "response.completed" && o.response && typeof o.response === "object") {
		const r = o.response as { usage?: Record<string, unknown>; model?: string };
		const u = r.usage;
		if (u) {
			const inTok = num(u.input_tokens);
			const outTok = num(u.output_tokens);
			const detailsIn = u.input_tokens_details as Record<string, unknown> | undefined;
			const cacheRead = detailsIn ? num(detailsIn.cached_tokens) : num(u.cache_read_input_tokens);
			return {
				provider: "openai",
				model: r.model,
				input: inTok,
				output: outTok,
				cacheRead,
				totalTokens: num(u.total_tokens) || inTok + outTok,
				source: "sse",
			};
		}
	}


	// Google Gemini (AI Studio / Vertex) — usageMetadata on candidate or response
	const usageMeta = (o.usageMetadata ?? (o.response as Record<string, unknown> | undefined)?.usageMetadata) as
		| Record<string, unknown>
		| undefined;
	if (usageMeta && (usageMeta.promptTokenCount != null || usageMeta.candidatesTokenCount != null)) {
		const input = num(usageMeta.promptTokenCount);
		const output = num(usageMeta.candidatesTokenCount);
		const total = num(usageMeta.totalTokenCount) || input + output;
		const cached = num(usageMeta.cachedContentTokenCount);
		return {
			input,
			output,
			totalTokens: total,
			cacheRead: cached,
			source: "sse",
			provider: "google-ai-studio",
		};
	}

	// AWS Bedrock stream metrics
	const metrics = o.metrics as Record<string, unknown> | undefined;
	if (metrics && (metrics.inputTokenCount != null || metrics.outputTokenCount != null)) {
		return {
			input: num(metrics.inputTokenCount),
			output: num(metrics.outputTokenCount),
			totalTokens: num(metrics.totalTokenCount) || num(metrics.inputTokenCount) + num(metrics.outputTokenCount),
			source: "sse",
			provider: "bedrock",
		};
	}

	// Bedrock Converse stream event
	if (o.message && typeof o.message === "object") {
		const m = o.message as { usage?: Record<string, unknown> };
		if (m.usage?.inputTokens != null) {
			return {
				input: num(m.usage.inputTokens),
				output: num(m.usage.outputTokens),
				totalTokens: num(m.usage.totalTokens),
				source: "sse",
				provider: "bedrock",
			};
		}
	}

	// Generic usage block (pi-ai normalized in some paths)
	if (o.usage && typeof o.usage === "object") {
		const u = o.usage as PiUsage;
		const m = fromPiUsage(u, "sse");
		return m ?? null;
	}

	return null;
}

export function foldSseUsage(lines: string[]): UsageMetrics | null {
	let acc = emptyMetrics("sse");
	let any = false;
	for (const line of lines) {
		const t = line.trim();
		if (!t.startsWith("data:")) continue;
		const payload = t.slice(5).trim();
		if (payload === "[DONE]") continue;
		try {
			const obj = JSON.parse(payload) as unknown;
			const part = extractUsageFromSseJson(obj);
			if (part) {
				acc = mergeUsage(acc, part);
				any = true;
			}
		} catch {
			// skip
		}
	}
	if (!any && acc.totalTokens === 0) return null;
	acc.cacheHitRate = cacheHitRate(acc.input, acc.cacheRead);
	return acc;
}

export function formatUsageShort(m: UsageMetrics, locale: "zh" | "en"): string {
	const pct = (m.cacheHitRate * 100).toFixed(0);
	const cost = m.costTotal > 0 ? `$${m.costTotal.toFixed(4)}` : "—";
	if (locale === "zh") {
		return `in ${m.input} · out ${m.output} · 缓存 ${pct}% · ${cost}`;
	}
	return `in ${m.input} · out ${m.output} · cache ${pct}% · ${cost}`;
}

export function sumUsage(list: UsageMetrics[]): UsageMetrics {
	const acc = emptyMetrics("message_end");
	for (const m of list) {
		acc.input += m.input;
		acc.output += m.output;
		acc.cacheRead += m.cacheRead;
		acc.cacheWrite += m.cacheWrite;
		acc.totalTokens += m.totalTokens;
		acc.costTotal += m.costTotal;
		acc.costInput += m.costInput;
		acc.costOutput += m.costOutput;
		acc.costCacheRead += m.costCacheRead;
		acc.costCacheWrite += m.costCacheWrite;
	}
	acc.cacheHitRate = cacheHitRate(acc.input, acc.cacheRead);
	return acc;
}

import { detectPlatformFromUrl } from "./observability/provider-detect.js";
import type { VendorPlatformId } from "./observability/vendor-platform.js";

export type FoldSseResult = { usage: UsageMetrics; platform: VendorPlatformId | "openai" | null };

export function foldSseUsageWithMeta(lines: string[], url?: string): FoldSseResult | null {
	const usage = foldSseUsage(lines);
	if (!usage) return null;
	const platform = url ? detectPlatformFromUrl(url) : null;
	if (platform && !usage.provider) usage.provider = platform;
	return { usage, platform };
}
