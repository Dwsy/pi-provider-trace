import { extractUsageFromSseJson } from "../../usage-metrics.js";

export const providerId = "openai-responses";

export function parseSseLine(line: string): ReturnType<typeof extractUsageFromSseJson> {
	const t = line.trim();
	if (!t.startsWith("data:")) return null;
	const payload = t.slice(5).trim();
	if (payload === "[DONE]") return null;
	try {
		const obj = JSON.parse(payload) as { type?: string };
		if (obj.type?.startsWith("response.")) return extractUsageFromSseJson(obj);
		return extractUsageFromSseJson(obj);
	} catch {
		return null;
	}
}
