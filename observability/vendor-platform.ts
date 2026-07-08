/** Canonical LLM platform ids (pi / cloud routing). */
export type VendorPlatformId =
	| "anthropic"
	| "openai"
	| "azure"
	| "bedrock"
	| "google-vertex-ai"
	| "google-ai-studio";

export const VENDOR_PLATFORM_LABELS: Record<VendorPlatformId, string> = {
	anthropic: "Anthropic",
	openai: "OpenAI",
	azure: "Azure OpenAI",
	bedrock: "AWS Bedrock",
	"google-vertex-ai": "Google Vertex AI",
	"google-ai-studio": "Google AI Studio",
};

export function isVendorPlatformId(v: string): v is VendorPlatformId {
	return v in VENDOR_PLATFORM_LABELS;
}
