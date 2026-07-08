import { LOBE_PROVIDER_CDN, LOBE_PROVIDER_SLUG, lobeCdnForSlug } from "./provider-icons.generated.js";

/** Infer Lobe CDN icon URL from pi provider id, model id, or request URL. */
export function resolveProviderIconUrl(opts: {
	provider?: string;
	model?: string;
	url?: string;
}): { slug: string; url: string; label: string } | null {
	const provider = (opts.provider ?? "").toLowerCase().trim();
	const model = (opts.model ?? "").toLowerCase().trim();
	const url = (opts.url ?? "").toLowerCase();

	let key = provider;
	if (!key && model) {
		if (model.includes("claude") || model.includes("anthropic")) key = "anthropic";
		else if (model.includes("gpt") || model.includes("o1") || model.includes("o3") || model.includes("o4"))
			key = "openai";
		else if (model.includes("gemini")) key = "google";
		else if (model.includes("deepseek")) key = "deepseek";
		else if (model.includes("mistral")) key = "mistral";
		else if (model.includes("llama")) key = "meta";
		else if (model.includes("grok")) key = "xai";
	}

	if (!key && url) {
		if (url.includes("anthropic")) key = "anthropic";
		else if (url.includes("openai.com") || url.includes("/v1/responses")) key = "openai";
		else if (url.includes("generativelanguage") || url.includes("googleapis")) key = "google";
		else if (url.includes("deepseek")) key = "deepseek";
		else if (url.includes("mistral")) key = "mistral";
		else if (url.includes("groq")) key = "groq";
		else if (url.includes("openrouter")) key = "openrouter";
		else if (url.includes("together")) key = "together";
		else if (url.includes("fireworks")) key = "fireworks";
		else if (url.includes("cohere")) key = "cohere";
		else if (url.includes("bedrock") || url.includes("amazonaws")) key = "bedrock";
		else if (url.includes("azure")) key = "azure";
	}

	if (!key) return null;

	const slug = LOBE_PROVIDER_SLUG[key] ?? key.replace(/[^a-z0-9]/g, "");
	const cdn = LOBE_PROVIDER_CDN[key] ?? lobeCdnForSlug(slug, "color");
	const label = opts.provider || opts.model || key;
	return { slug, url: cdn, label };
}

/** JSON map for embedding in trace UI (pi provider key → icon URL). */
export function providerIconMapForUi(): Record<string, string> {
	return { ...LOBE_PROVIDER_CDN };
}