import { extractUsageFromSseJson } from "../../usage-metrics.js";

export const providerId = "azure";

export function parseSseLine(line: string): ReturnType<typeof extractUsageFromSseJson> {
	const t = line.trim();
	if (!t.startsWith("data:")) return null;
	const payload = t.slice(5).trim();
	if (payload === "[DONE]") return null;
	try {
		const part = extractUsageFromSseJson(JSON.parse(payload));
		if (part && !part.provider) part.provider = "azure";
		return part;
	} catch {
		return null;
	}
}
