import type { VendorPlatformId } from "./vendor-platform.js";

export type ProviderDetectResult = {
	platform: VendorPlatformId;
	/** pi provider id or gateway label */
	provider?: string;
	model?: string;
};

function hostMatch(url: string, needles: string[]): boolean {
	const u = url.toLowerCase();
	return needles.some((n) => u.includes(n));
}

/** Classify HTTP URL to one of six platforms (+ openai for generic OpenAI API). */
export function detectPlatformFromUrl(url: string): VendorPlatformId | "openai" | null {
	const u = url.toLowerCase();
	if (u.includes("anthropic.com") || u.includes("/v1/messages")) return "anthropic";
	if (u.includes("bedrock") || u.includes("bedrock-runtime") || (u.includes("amazonaws.com") && u.includes("model")))
		return "bedrock";
	if (u.includes("openai.azure.com") || (u.includes("azure") && (u.includes("openai") || u.includes("cognitiveservices"))))
		return "azure";
	if (u.includes("aiplatform.googleapis.com") || u.includes("/vertex-ai") || u.includes("vertexai"))
		return "google-vertex-ai";
	if (u.includes("generativelanguage.googleapis.com") || u.includes("ai.google.dev"))
		return "google-ai-studio";
	if (
		u.includes("openai.com") ||
		u.includes("/v1/responses") ||
		u.includes("/v1/chat/completions") ||
		u.includes("/chat/completions")
	)
		return "openai";
	if (u.includes("googleapis.com") && u.includes("generatecontent")) return "google-ai-studio";
	return null;
}

export function normalizePiProviderId(raw?: string): VendorPlatformId | "openai" | undefined {
	if (!raw) return undefined;
	const k = raw.toLowerCase().trim();
	if (k === "anthropic" || k.includes("claude")) return "anthropic";
	if (k === "openai" || k.includes("gpt")) return "openai";
	if (k === "azure" || k.includes("azure")) return "azure";
	if (k === "bedrock" || k.includes("bedrock")) return "bedrock";
	if (k === "google-vertex-ai" || k.includes("vertex")) return "google-vertex-ai";
	if (k === "google-ai-studio" || k === "google" || k.includes("gemini")) return "google-ai-studio";
	return undefined;
}

export function enrichUsagePlatform<T extends { provider?: string; model?: string; url?: string }>(
	usage: T,
	url?: string,
): T & { platform?: VendorPlatformId | "openai" } {
	const fromUrl = url ? detectPlatformFromUrl(url) : null;
	const fromPi = normalizePiProviderId(usage.provider);
	const platform = (fromUrl ?? fromPi) as VendorPlatformId | "openai" | undefined;
	if (!platform) return usage;
	return { ...usage, provider: usage.provider ?? platform, platform };
}
