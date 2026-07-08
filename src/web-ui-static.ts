import { existsSync, readFileSync } from "node:fs";
import { dirname, join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
};

export function getPublicDir(): string {
	return PUBLIC_DIR;
}

/** Safe static file under public/ (no path traversal). */
export function readPublicFile(urlPath: string): { body: Buffer; contentType: string } | null {
	const pathOnly = urlPath.split("?")[0] ?? "/";
	const rel = pathOnly === "/" ? "index.html" : pathOnly.replace(/^\//, "");
	if (!rel || rel.includes("..")) return null;

	const resolved = normalize(join(PUBLIC_DIR, rel));
	if (!resolved.startsWith(PUBLIC_DIR)) return null;
	if (!existsSync(resolved)) return null;

	const ext = extname(resolved).toLowerCase();
	const contentType = MIME[ext] ?? "application/octet-stream";
	return { body: readFileSync(resolved), contentType };
}