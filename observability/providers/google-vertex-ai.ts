import { extractUsageFromSseJson } from "../../usage-metrics.js";

export const providerId = "google-vertex-ai";

export function parseSseLine(line: string): ReturnType<typeof extractUsageFromSseJson> {
	const t = line.trim();
	if (!t.startsWith("data:")) return null;
	const payload = t.slice(5).trim();
	if (payload === "[DONE]") return null;
	try {
		const part = extractUsageFromSseJson(JSON.parse(payload));
		if (part && !part.provider) part.provider = "google-vertex-ai";
		return part;
	} catch {
		return null;
	}
}
