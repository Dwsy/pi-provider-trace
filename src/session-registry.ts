import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";

export type SessionRegistryEntry = {
	key: string;
	label: string;
	lastTs: string;
	records: number;
	/** bytes of http-sse.jsonl if present */
	httpLogBytes?: number;
	hasPayloadLog?: boolean;
};

type RegistryFile = {
	sessions: Record<string, SessionRegistryEntry>;
};

function registryPath(logDir: string): string {
	return join(logDir, "registry.json");
}

function loadRegistry(logDir: string): RegistryFile {
	const path = registryPath(logDir);
	if (!existsSync(path)) return { sessions: {} };
	try {
		return JSON.parse(readFileSync(path, "utf8")) as RegistryFile;
	} catch {
		return { sessions: {} };
	}
}

function saveRegistry(logDir: string, reg: RegistryFile): void {
	if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
	writeFileSync(registryPath(logDir), JSON.stringify(reg, null, 2), "utf8");
}

function sessionDir(logDir: string, key: string): string {
	return join(logDir, "sessions", key);
}

function fileMtimeIso(path: string): string | null {
	try {
		return statSync(path).mtime.toISOString();
	} catch {
		return null;
	}
}

function countJsonlLines(path: string): number {
	if (!existsSync(path)) return 0;
	try {
		const raw = readFileSync(path, "utf8");
		return raw.split("\n").filter((l) => l.trim()).length;
	} catch {
		return 0;
	}
}

/** Merge registry.json with on-disk session subdirs so history always visible. */
export function listAllSessions(logDir: string): SessionRegistryEntry[] {
	const reg = loadRegistry(logDir);
	const merged = new Map<string, SessionRegistryEntry>();

	for (const e of Object.values(reg.sessions)) {
		merged.set(e.key, { ...e });
	}

	const sessionsRoot = join(logDir, "sessions");
	if (existsSync(sessionsRoot)) {
		for (const name of readdirSync(sessionsRoot)) {
			const dir = join(sessionsRoot, name);
			try {
				if (!statSync(dir).isDirectory()) continue;
			} catch {
				continue;
			}
			const httpPath = join(dir, "http-sse.jsonl");
			const lines = countJsonlLines(httpPath);
			const mtime = existsSync(httpPath) ? fileMtimeIso(httpPath) : null;
			const prev = merged.get(name);
			merged.set(name, {
				key: name,
				label: prev?.label ?? name,
				lastTs: prev?.lastTs && mtime ? (prev.lastTs > mtime ? prev.lastTs : mtime) : prev?.lastTs ?? mtime ?? "",
				records: Math.max(prev?.records ?? 0, lines),
				httpLogBytes: existsSync(httpPath) ? statSync(httpPath).size : 0,
				hasPayloadLog: existsSync(join(dir, "provider-payload.jsonl")),
			});
		}
	}

	return [...merged.values()]
		.filter((s) => s.records > 0 || (s.httpLogBytes ?? 0) > 0)
		.sort((a, b) => (b.lastTs || "").localeCompare(a.lastTs || ""));
}

export function touchSessionInRegistry(
	logDir: string,
	key: string,
	label: string,
	ts: string,
): void {
	if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
	const reg = loadRegistry(logDir);
	const prev = reg.sessions[key];
	reg.sessions[key] = {
		key,
		label: label || prev?.label || key,
		lastTs: ts,
		records: (prev?.records ?? 0) + 1,
	};
	saveRegistry(logDir, reg);
}

export function listSessionsFromRegistry(logDir: string): SessionRegistryEntry[] {
	return listAllSessions(logDir);
}

export function removeSessionFromRegistry(logDir: string, key: string): void {
	const reg = loadRegistry(logDir);
	delete reg.sessions[key];
	saveRegistry(logDir, reg);
}

export function deleteSessionTrace(logDir: string, key: string): boolean {
	const dir = sessionDir(logDir, key);
	if (existsSync(dir)) {
		rmSync(dir, { recursive: true, force: true });
	}
	removeSessionFromRegistry(logDir, key);
	return true;
}

export type SessionDownloadFile = "http-sse" | "provider-payload";

export function resolveSessionDownloadPath(
	logDir: string,
	key: string,
	file: SessionDownloadFile,
): string | null {
	const map: Record<SessionDownloadFile, string> = {
		"http-sse": "http-sse.jsonl",
		"provider-payload": "provider-payload.jsonl",
	};
	const path = join(sessionDir(logDir, key), map[file]);
	return existsSync(path) ? path : null;
}

export function sessionLogPath(logDir: string, sessionKey: string): string {
	const dir = join(logDir, "sessions", sessionKey);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return join(dir, "http-sse.jsonl");
}