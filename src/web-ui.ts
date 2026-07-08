import { createServer, type Server } from "node:http";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getProviderTraceRoot } from "./trace-paths.js";
import {
	getHttpSseLogPath,
	getTraceLogDir,
	isTraceEnabled,
	setTraceLogDir,
	subscribeTrace,
	type TraceRecord,
} from "./logger.js";
import {
	deleteSessionTrace,
	listAllSessions,
	resolveSessionDownloadPath,
	type SessionDownloadFile,
} from "./session-registry.js";
import { getActiveSession } from "./session-context.js";
import { DEFAULT_TRACE_UI_PORT, getTraceUiPort } from "./trace-config.js";
import { I18N, t } from "./web-ui-i18n.js";
import { resolveCliLocale } from "./cli-locale.js";
import { providerIconMapForUi } from "./provider-resolve.js";
import { readPublicFile } from "./web-ui-static.js";
import {
	deriveGenerationMetrics,
	foldExchangeFromRecords,
	rollupTraceMetrics,
	rollupTraceMetricsWithScores,
	rollupObservationMetrics,
} from "./observability/derive-metrics.js";
import { extractMediaFromRequestBody } from "./observability/media-extract.js";
import { appendScore, listScores } from "./observability/scores-store.js";
import type { ScoreEvent } from "./observability/types.js";

const execFileAsync = promisify(execFile);

/** @deprecated use getTraceUiPort() */
export const TRACE_UI_PORT = DEFAULT_TRACE_UI_PORT;

let server: Server | null = null;
let boundPort: number | null = null;
const sseClients = new Set<(data: string) => void>();
let unsubscribe: (() => void) | null = null;

function broadcast(record: TraceRecord): void {
	const line = `data: ${JSON.stringify(record)}\n\n`;
	for (const send of sseClients) {
		try {
			send(line);
		} catch {
			sseClients.delete(send);
		}
	}
}

function tailJsonl(path: string, maxLines = 800): TraceRecord[] {
	if (!existsSync(path)) return [];
	try {
		const raw = readFileSync(path, "utf8");
		const lines = raw.split("\n").filter((l) => l.trim());
		const slice = lines.slice(-maxLines);
		const out: TraceRecord[] = [];
		for (const line of slice) {
			try {
				out.push(JSON.parse(line) as TraceRecord);
			} catch {
				// skip
			}
		}
		return out;
	} catch {
		return [];
	}
}

function writePortFile(port: number): void {
	const dir = getTraceLogDir();
	if (!dir) return;
	try {
		writeFileSync(
			join(dir, "trace-ui-port.json"),
			JSON.stringify({ port, at: new Date().toISOString() }),
			"utf8",
		);
	} catch {
		// ignore
	}
}

export function getTraceUiUrl(): string | null {
	const port = boundPort ?? getTraceUiPort();
	return `http://127.0.0.1:${port}/`;
}

function ensureLogDir(): string {
	if (!getTraceLogDir()) {
		setTraceLogDir(getProviderTraceRoot());
	}
	return getTraceLogDir()!;
}

function createHandler(getPort: () => number) {
	return (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
		const port = getPort();
		const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
		const logDir = ensureLogDir();

		if (req.method === "GET" && url.pathname === "/api/i18n") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(I18N));
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/sessions") {
			const sessions = listAllSessions(logDir);
			const active = getActiveSession();
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					sessions,
					activeSessionKey: active.key,
					activeSessionLabel: active.label,
					port,
				}),
			);
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/provider-icons") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(providerIconMapForUi()));
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/status") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					traceEnabled: isTraceEnabled(),
					port,
					activeSession: getActiveSession(),
				}),
			);
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/download") {
			const key = url.searchParams.get("session");
			const file = (url.searchParams.get("file") ?? "http-sse") as SessionDownloadFile;
			if (!key || !/^[a-zA-Z0-9._-]+$/.test(key)) {
				res.writeHead(400);
				res.end("bad session");
				return;
			}
			const path = resolveSessionDownloadPath(logDir, key, file);
			if (!path) {
				res.writeHead(404);
				res.end("not found");
				return;
			}
			const body = readFileSync(path);
			const filename = `${key}-${basename(path)}`;
			res.writeHead(200, {
				"Content-Type": "application/x-ndjson",
				"Content-Disposition": `attachment; filename="${filename}"`,
			});
			res.end(body);
			return;
		}

		if (req.method === "DELETE" && url.pathname === "/api/session") {
			const key = url.searchParams.get("key");
			if (!key || !/^[a-zA-Z0-9._-]+$/.test(key)) {
				res.writeHead(400);
				res.end(JSON.stringify({ ok: false, error: "bad key" }));
				return;
			}
			deleteSessionTrace(logDir, key);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true, key }));
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/metrics") {
			const key = url.searchParams.get("session");
			if (!key || !/^[a-zA-Z0-9._-]+$/.test(key)) {
				res.writeHead(400);
				res.end(JSON.stringify({ error: "bad session" }));
				return;
			}
			const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get("limit") ?? 3000)));
			const path = getHttpSseLogPath(key);
			const records = path ? tailJsonl(path, limit) : [];
			const exchangeMap = foldExchangeFromRecords(records);
			const scores = listScores(logDir, key);
			const trace = rollupTraceMetricsWithScores(records, scores);
			const observation = rollupObservationMetrics(exchangeMap.values());
			const generations: Array<{ id: string; metrics: ReturnType<typeof deriveGenerationMetrics> }> = [];
			for (const ex of exchangeMap.values()) {
				if (!ex.requestTs) continue;
				const metrics = deriveGenerationMetrics(ex);
				if (metrics) generations.push({ id: ex.id, metrics });
			}
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ sessionKey: key, trace, observation, generations, scores }));
			return;
		}


		if (req.method === "GET" && url.pathname === "/api/scores") {
			const key = url.searchParams.get("session");
			if (!key || !/^[a-zA-Z0-9._-]+$/.test(key)) {
				res.writeHead(400);
				res.end("[]");
				return;
			}
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(listScores(logDir, key)));
			return;
		}

		if (req.method === "POST" && url.pathname === "/api/scores") {
			const key = url.searchParams.get("session");
			if (!key || !/^[a-zA-Z0-9._-]+$/.test(key)) {
				res.writeHead(400);
				res.end(JSON.stringify({ ok: false }));
				return;
			}
			void (async () => {
				let body = "";
				for await (const chunk of req) body += chunk;
				try {
					const parsed = JSON.parse(body) as { name?: string; value?: number | string; observationId?: string; dataType?: string };
					if (!parsed.name || parsed.value == null) {
						res.writeHead(400);
						res.end(JSON.stringify({ ok: false }));
						return;
					}
					const score: ScoreEvent = {
						schemaVersion: 1,
						kind: "score",
						id: `score-${Date.now().toString(36)}`,
						traceId: key,
						observationId: parsed.observationId,
						name: parsed.name,
						value: parsed.value,
						dataType: (parsed.dataType as ScoreEvent["dataType"]) || (typeof parsed.value === "number" ? "NUMERIC" : "CATEGORICAL"),
						ts: new Date().toISOString(),
					};
					appendScore(logDir, key, score);
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ ok: true, score }));
				} catch {
					res.writeHead(400);
					res.end(JSON.stringify({ ok: false }));
				}
			})();
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/media") {
			const key = url.searchParams.get("session");
			const exId = url.searchParams.get("exchange");
			if (!key || !exId) {
				res.writeHead(400);
				res.end("[]");
				return;
			}
			const path = getHttpSseLogPath(key);
			const records = path ? tailJsonl(path, 3000) : [];
			const reqRec = records.find((r) => r.id === exId && r.kind === "request");
			const media = extractMediaFromRequestBody(reqRec?.bodyPreview);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(media));
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/history") {
			const key = url.searchParams.get("session");
			if (!key || !/^[a-zA-Z0-9._-]+$/.test(key)) {
				res.writeHead(400);
				res.end("[]");
				return;
			}
			const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get("limit") ?? 2000)));
			const path = getHttpSseLogPath(key);
			const records = path ? tailJsonl(path, limit) : [];
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(records));
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/stream") {
			const sessionKey = url.searchParams.get("session") ?? undefined;
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			});
			const send = (chunk: string) => {
				try {
					res.write(chunk);
				} catch {
					sseClients.delete(send);
				}
			};
			sseClients.add(send);

			// Live-only for a selected session: UI already loads history via GET /api/history.
			// Replaying the full JSONL here duplicates every pi_event / HTTP row in the timeline.
			if (!sessionKey) {
				for (const s of listAllSessions(logDir)) {
					const path = getHttpSseLogPath(s.key);
					if (path) {
						for (const rec of tailJsonl(path, 200)) {
							send(`data: ${JSON.stringify(rec)}\n\n`);
						}
					}
				}
			}

			req.on("close", () => sseClients.delete(send));
			return;
		}

		if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
			const file = readPublicFile(url.pathname);
			if (file) {
				res.writeHead(200, { "Content-Type": file.contentType });
				res.end(file.body);
				return;
			}
			if (url.pathname === "/favicon.ico") {
				res.writeHead(204);
				res.end();
				return;
			}
		}

		res.writeHead(404);
		res.end("Not found");
	};
}

async function closeServer(): Promise<void> {
	if (!server) return;
	await new Promise<void>((resolve) => server!.close(() => resolve()));
	server = null;
	boundPort = null;
	sseClients.clear();
}

export async function startTraceWebUi(): Promise<string> {
	ensureLogDir();
	const port = getTraceUiPort();

	if (!unsubscribe) {
		unsubscribe = subscribeTrace((rec) => broadcast(rec));
	}

	if (server && boundPort !== null && boundPort !== port) {
		await closeServer();
	}

	if (!server) {
		boundPort = port;
		server = createServer(createHandler(() => boundPort ?? port));
		await new Promise<void>((resolve, reject) => {
			server!.once("error", (err: NodeJS.ErrnoException) => {
				boundPort = null;
				server = null;
				if (err.code === "EADDRINUSE") {
					const loc = resolveCliLocale();
					reject(new Error(t(loc, "cmdTracePortInUse", { port: String(port) })));
					return;
				}
				reject(err);
			});
			server!.listen(port, "127.0.0.1", () => resolve());
		});
		writePortFile(port);
	}

	return `http://127.0.0.1:${boundPort ?? port}/`;
}

export async function stopTraceWebUi(): Promise<void> {
	if (unsubscribe) {
		unsubscribe();
		unsubscribe = null;
	}
	await closeServer();
}

export async function openBrowser(url: string): Promise<void> {
	if (process.platform === "darwin") {
		await execFileAsync("open", [url]);
		return;
	}
	if (process.platform === "win32") {
		await execFileAsync("cmd", ["/c", "start", "", url]);
		return;
	}
	await execFileAsync("xdg-open", [url]);
}
