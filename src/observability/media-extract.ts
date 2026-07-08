import type { MediaRef } from "./types.js";

/** Extract image/audio refs from provider request body preview (JSON string). */
export function extractMediaFromRequestBody(bodyPreview: string | undefined): MediaRef[] {
	if (!bodyPreview) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(bodyPreview);
	} catch {
		return [];
	}
	const out: MediaRef[] = [];
	walk(parsed, out);
	return out.slice(0, 20);
}

function walk(node: unknown, out: MediaRef[]): void {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const item of node) walk(item, out);
		return;
	}
	const o = node as Record<string, unknown>;
	if (o.type === "image" && typeof o.source === "object" && o.source) {
		const src = o.source as Record<string, unknown>;
		if (src.type === "url" && typeof src.url === "string") {
			out.push({ type: "image", url: src.url });
		} else if (src.type === "base64" && typeof src.media_type === "string") {
			out.push({ type: "image", mimeType: src.media_type, previewRef: "base64:" + String(src.data || "").slice(0, 32) });
		}
	}
	if (o.type === "input_image" && typeof o.image_url === "string") {
		out.push({ type: "image", url: o.image_url });
	}
	if (o.inline_data && typeof o.inline_data === "object") {
		const inl = o.inline_data as { mime_type?: string };
		out.push({ type: "image", mimeType: inl.mime_type, previewRef: "inline" });
	}
	for (const v of Object.values(o)) walk(v, out);
}
