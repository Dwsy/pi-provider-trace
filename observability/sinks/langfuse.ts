/** Stub for future Langfuse production export — 本期不开发，见 docs/future-langfuse.md */
import type { TraceMetrics } from "../types.js";

export type LangfuseConfig = {
	host: string;
	publicKey: string;
	secretKey: string;
	enabled: boolean;
};

export function langfuseConfigFromEnv(): LangfuseConfig | null {
	const host = process.env.LANGFUSE_HOST?.trim() || process.env.LANGFUSE_BASE_URL?.trim();
	const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
	const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
	if (!host || !publicKey || !secretKey) return null;
	return { host: host.replace(/\/$/, ""), publicKey, secretKey, enabled: true };
}

/** Minimal batch payload stub for Langfuse ingestion (extend per Public API). */
export function buildLangfuseGenerationBatch(opts: {
	traceId: string;
	observationId: string;
	name: string;
	model?: string;
	metrics?: { inputTokens?: number; outputTokens?: number; totalCost?: number; latencyMs?: number };
}): Record<string, unknown> {
	return {
		batch: [
			{
				type: "generation-create",
				body: {
					id: opts.observationId,
					traceId: opts.traceId,
					name: opts.name,
					model: opts.model,
					usage: {
						input: opts.metrics?.inputTokens,
						output: opts.metrics?.outputTokens,
						totalCost: opts.metrics?.totalCost,
					},
					metadata: { latencyMs: opts.metrics?.latencyMs, source: "pi-provider-trace" },
				},
			},
		],
	};
}

export async function postLangfuseBatch(
	config: LangfuseConfig,
	body: Record<string, unknown>,
	fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ ok: boolean; status: number }> {
	const url = `${config.host}/api/public/ingestion`;
	const auth = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64");
	const res = await fetchFn(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
		body: JSON.stringify(body),
	});
	return { ok: res.ok, status: res.status };
}

export function traceToLangfuseSummary(sessionKey: string, trace: TraceMetrics): Record<string, unknown> {
	return {
		traceId: sessionKey,
		name: "pi-session",
		metadata: { generationCount: trace.generationCount, totalCost: trace.totalCost },
	};
}
