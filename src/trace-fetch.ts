import { previewBody, redactHeaders, writeTrace } from "./logger.js";
import { getActiveExchangeId, setActiveExchangeId } from "./http-exchange-context.js";
import { SseUsageAccumulator } from "./usage-metrics.js";
import { detectPlatformFromUrl } from "./observability/provider-detect.js";
import { StreamAccumulator } from "./stream-result.js";

let installed = false;
let originalFetch: typeof globalThis.fetch | undefined;

function nextId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isLikelyLlmUrl(url: string): boolean {
	const u = url.toLowerCase();
	if (u.includes("/v1/messages") || u.includes("/v1/chat/completions")) return true;
	if (u.includes("/v1/responses") || u.includes("openai.com") || u.includes("anthropic.com")) return true;
	if (u.includes("/v1internal") || u.includes("generativelanguage")) return true;
	if (u.includes("openai.azure.com") || u.includes("aiplatform.googleapis.com")) return true;
	if (u.includes("bedrock-runtime") || u.includes("bedrock.")) return true;
	if (u.includes("generatecontent")) return true;
	if (u.includes("/chat/completions") || u.includes("/completions")) return true;
	return false;
}

async function drainSseLog(id: string, body: ReadableStream<Uint8Array>, url: string): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const stream = new StreamAccumulator();
	const usage = new SseUsageAccumulator();
	let buffer = "";
	let lastPublishAt = 0;
	let publishedTextLength = 0;
	let publishedReasoningLength = 0;

	const acceptLine = (line: string) => {
		const trimmed = line.trimEnd();
		if (!trimmed) return;
		const ts = new Date().toISOString();
		usage.acceptLine(trimmed);
		const changed = stream.acceptLine(trimmed, ts);
		const now = Date.now();
		if (!changed || now - lastPublishAt < 50) return;
		lastPublishAt = now;
		const snapshot = stream.snapshot("streaming");
		const textDelta = snapshot.text.slice(publishedTextLength);
		const reasoningDelta = snapshot.reasoning.slice(publishedReasoningLength);
		publishedTextLength = snapshot.text.length;
		publishedReasoningLength = snapshot.reasoning.length;
		writeTrace({
			ts,
			kind: "stream_update",
			id,
			url,
			stream: { ...snapshot, text: "", reasoning: "" },
			streamDelta: { text: textDelta, reasoning: reasoningDelta },
		});
	};

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let idx: number;
			while ((idx = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 1);
				acceptLine(line);
			}
		}
		buffer += decoder.decode();
		if (buffer.trim()) acceptLine(buffer);

		writeTrace({
			ts: new Date().toISOString(),
			kind: "stream_result",
			id,
			url,
			stream: stream.snapshot("complete"),
		});

		const usageResult = usage.result();
		if (usageResult) {
			const platform = detectPlatformFromUrl(url);
			if (platform && !usageResult.provider) usageResult.provider = platform;
			writeTrace({
				ts: new Date().toISOString(),
				kind: "llm_usage",
				id,
				url,
				usage: usageResult,
				summary: `usage (sse) ${usageResult.provider ?? platform ?? "?"} in ${usageResult.input} out ${usageResult.output} cache ${(usageResult.cacheHitRate * 100).toFixed(0)}%`,
			});
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		writeTrace({
			ts: new Date().toISOString(),
			kind: "stream_result",
			id,
			url,
			stream: stream.snapshot("error", message),
		});
		writeTrace({
			ts: new Date().toISOString(),
			kind: "error",
			id,
			url,
			message,
		});
	} finally {
		if (getActiveExchangeId() === id) setActiveExchangeId(null);
	}
}

export function installFetchTrace(): () => void {
	if (installed) return uninstallFetchTrace;
	originalFetch = globalThis.fetch.bind(globalThis);
	installed = true;

	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		let url: string;
		if (typeof input === "string") url = input;
		else if (input instanceof URL) url = input.href;
		else url = input.url;

		if (!isLikelyLlmUrl(url)) {
			return originalFetch!(input, init);
		}

		const id = nextId();
		const req = input instanceof Request ? input : new Request(input, init);
		const method = req.method;
		const traceThis = true;

		let bodyPreview: string | undefined;
		if (traceThis && req.body) {
			try {
				const clone = req.clone();
				bodyPreview = previewBody(await clone.text());
			} catch {
				bodyPreview = "[unreadable body]";
			}
		}

		if (traceThis) {
			setActiveExchangeId(id);
			writeTrace({
				ts: new Date().toISOString(),
				kind: "request",
				id,
				url,
				method,
				headers: redactHeaders(req.headers),
				bodyPreview,
			});
		}

		try {
			const response = await originalFetch!(input, init);
			if (!traceThis) return response;

			writeTrace({
				ts: new Date().toISOString(),
				kind: "response_meta",
				id,
				url,
				status: response.status,
				headers: redactHeaders(response.headers),
			});

			if (!response.body) {
				writeTrace({
					ts: new Date().toISOString(),
					kind: "stream_result",
					id,
					url,
					stream: new StreamAccumulator().snapshot("complete"),
				});
				setActiveExchangeId(null);
				return response;
			}

			const [logStream, passStream] = response.body.tee();
			void drainSseLog(id, logStream, url);

			return new Response(passStream, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			});
		} catch (err) {
			setActiveExchangeId(null);
			if (traceThis) {
				writeTrace({
					ts: new Date().toISOString(),
					kind: "error",
					id,
					url,
					message: err instanceof Error ? err.message : String(err),
				});
			}
			throw err;
		}
	};

	return uninstallFetchTrace;
}

export function uninstallFetchTrace(): void {
	if (!installed || !originalFetch) return;
	globalThis.fetch = originalFetch;
	installed = false;
	originalFetch = undefined;
}

export function isFetchTraceInstalled(): boolean {
	return installed;
}
