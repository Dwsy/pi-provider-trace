import { extractUsageFromSseJson } from "../../usage-metrics.js";

export const providerId = "anthropic";

export function parseSseLine(line: string): ReturnType<typeof extractUsageFromSseJson> {
	const t = line.trim();
	if (!t.startsWith("data:")) return null;
	const payload = t.slice(5).trim();
	if (payload === "[DONE]") return null;
	try {
		return extractUsageFromSseJson(JSON.parse(payload));
	} catch {
		return null;
	}
}
