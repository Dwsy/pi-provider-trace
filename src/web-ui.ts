import { createServer, type Server } from "node:http";
import {
	closeSync,
	createReadStream,
	existsSync,
	openSync,
	readFileSync,
	readSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getProviderTraceRoot } from "./trace-paths.js";
import {
	getHttpSseLogPath,
	getTraceLogDir,
	isTraceEnabled,
	listLiveTraceRecords,
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
import { StreamAccumulator } from "./stream-result.js";

const execFileAsync = promisify(execFile);

/** @deprecated use getTraceUiPort() */
export const TRACE_UI_PORT = DEFAULT_TRACE_UI_PORT;

let server: Server | null = null;
let boundPort: number | null = null;
type StreamClient = { sessionKey?: string; send(data: string): void };

const sseClients = new Set<StreamClient>();
let unsubscribe: (() => void) | null = null;

function broadcast(record: TraceRecord): void {
	const line = `data: ${JSON.stringify(record)}\n\n`;
	for (const client of sseClients) {
		if (client.sessionKey && record.sessionKey !== client.sessionKey) continue;
		try {
			client.send(line);
		} catch {
			sseClients.delete(client);
		}
	}
}

function tailJsonl(path: string, maxLines = 800): TraceRecord[] {
	if (!existsSync(path)) return [];
	let fd: number | null = null;
	try {
		const size = statSync(path).size;
		const maxBytes = 8 * 1024 * 1024;
		const length = Math.min(size, maxBytes);
		const start = Math.max(0, size - length);
		const buffer = Buffer.alloc(length);
		fd = openSync(path, "r");
		readSync(fd, buffer, 0, length, start);
		let raw = buffer.toString("utf8");
		if (start > 0) {
			const firstLineEnd = raw.indexOf("\n");
			raw = firstLineEnd >= 0 ? raw.slice(firstLineEnd + 1) : "";
		}
		const lines = raw.split("\n").filter((line) => line.trim());
		const out: TraceRecord[] = [];
		for (const line of lines) {
			try {
				out.push(JSON.parse(line) as TraceRecord);
			} catch {
				// skip
			}
		}
		return compactLegacySseRecords(out).slice(-maxLines);
	} catch {
		return [];
	} finally {
		if (fd != null) closeSync(fd);
	}
}

/** Old captures remain readable without sending thousands of raw rows to the browser. */
export function compactLegacySseRecords(records: TraceRecord[]): TraceRecord[] {
	const durableResultIds = new Set(
		records.filter((record) => record.kind === "stream_result").map((record) => record.id),
	);
	const groups = new Map<string, { accumulator: StreamAccumulator; last: TraceRecord }>();
	const compacted: TraceRecord[] = [];

	for (const record of records) {
		if (record.kind !== "sse_line") {
			compacted.push(record);
			continue;
		}
		if (durableResultIds.has(record.id)) continue;
		let group = groups.get(record.id);
		if (!group) {
			group = { accumulator: new StreamAccumulator(), last: record };
			groups.set(record.id, group);
		}
		group.last = record;
		if (record.line) group.accumulator.acceptLine(record.line, record.ts);
	}

	for (const [id, group] of groups) {
		compacted.push({
			ts: group.last.ts,
			kind: "stream_result",
			id,
			sessionKey: group.last.sessionKey,
			sessionLabel: group.last.sessionLabel,
			url: group.last.url,
			stream: group.accumulator.snapshot("complete"),
		});
	}

	return compacted.sort((a, b) => a.ts.localeCompare(b.ts));
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

/** True if something on `port` responds like this extension's Trace Web UI. */
export async function probeTraceUiOnPort(port: number): Promise<boolean> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 800);
	try {
		const res = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: ctrl.signal });
		if (!res.ok) return false;
		const body = (await res.json()) as { traceEnabled?: unknown; port?: unknown };
		return typeof body.traceEnabled === "boolean" && typeof body.port === "number";
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
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

		if (req.method === "GET" && url.pathname === "/api/download-batch") {
			const keys = [...new Set(url.searchParams.getAll("session"))];
			if (!keys.length || keys.length > 200 || keys.some((key) => !/^[a-zA-Z0-9._-]+$/.test(key))) {
				res.writeHead(400);
				res.end("bad sessions");
				return;
			}
			const files = keys
				.map((key) => resolveSessionDownloadPath(logDir, key, "http-sse"))
				.filter((path): path is string => Boolean(path));
			if (!files.length) {
				res.writeHead(404);
				res.end("not found");
				return;
			}
			res.writeHead(200, {
				"Content-Type": "application/x-ndjson",
				"Content-Disposition": `attachment; filename="provider-trace-${files.length}-sessions.jsonl"`,
				"Cache-Control": "no-store",
			});
			let current: ReturnType<typeof createReadStream> | null = null;
			let index = 0;
			const pipeNext = () => {
				if (res.writableEnded || res.destroyed) return;
				if (index >= files.length) {
					res.end();
					return;
				}
				current = createReadStream(files[index++]);
				current.once("error", pipeNext);
				current.once("end", () => {
					if (!res.writableEnded) res.write("\n");
					pipeNext();
				});
				current.pipe(res, { end: false });
			};
			res.once("close", () => current?.destroy());
			pipeNext();
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
			res.end(JSON.stringify({ records, live: listLiveTraceRecords(key) }));
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/stream") {
			const sessionKey = url.searchParams.get("session") ?? undefined;
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			});
			const client: StreamClient = {
				sessionKey,
				send(chunk) {
					res.write(chunk);
				},
			};
			sseClients.add(client);
			res.write(": connected\n\n");
			for (const record of listLiveTraceRecords(sessionKey)) {
				client.send(`data: ${JSON.stringify(record)}\n\n`);
			}
			const heartbeat = setInterval(() => {
				try {
					client.send(": keepalive\n\n");
				} catch {
					sseClients.delete(client);
					clearInterval(heartbeat);
				}
			}, 15_000);
			heartbeat.unref();
			req.on("close", () => {
				clearInterval(heartbeat);
				sseClients.delete(client);
			});
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
		const loc = resolveCliLocale();
		const pending = createServer(createHandler(() => boundPort ?? port));
		await new Promise<void>((resolve, reject) => {
			pending.once("error", (err: NodeJS.ErrnoException) => {
				if (err.code === "EADDRINUSE") {
					void (async () => {
						if (await probeTraceUiOnPort(port)) {
							boundPort = port;
							writePortFile(port);
							resolve();
							return;
						}
						boundPort = null;
						reject(new Error(t(loc, "cmdTracePortInUse", { port: String(port) })));
					})();
					return;
				}
				boundPort = null;
				reject(err);
			});
			pending.listen(port, "127.0.0.1", () => {
				server = pending;
				writePortFile(port);
				resolve();
			});
		});
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
