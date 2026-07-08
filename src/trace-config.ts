import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getProviderTraceRoot } from "./trace-paths.js";

export const DEFAULT_TRACE_UI_PORT = 32211;

const CONFIG_NAME = "ui-config.json";

type UiConfig = { port: number };

let runtimePort: number | null = null;

function configPath(): string {
	return join(getProviderTraceRoot(), CONFIG_NAME);
}

function clampPort(n: number): number {
	if (!Number.isFinite(n)) return DEFAULT_TRACE_UI_PORT;
	const p = Math.floor(n);
	if (p < 1024 || p > 65535) return DEFAULT_TRACE_UI_PORT;
	return p;
}

function readFileConfig(): number | null {
	const path = configPath();
	if (!existsSync(path)) return null;
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as UiConfig;
		if (typeof raw.port === "number") return clampPort(raw.port);
	} catch {
		// ignore
	}
	return null;
}

function readEnvPort(): number | null {
	const v = process.env.PI_PROVIDER_TRACE_UI_PORT?.trim() ?? process.env.PI_PROVIDER_TRACE_PORT?.trim();
	if (!v) return null;
	const n = Number(v);
	return Number.isFinite(n) ? clampPort(n) : null;
}

/** Effective UI port (runtime > file > env > default). */
export function getTraceUiPort(): number {
	if (runtimePort != null) return runtimePort;
	return readFileConfig() ?? readEnvPort() ?? DEFAULT_TRACE_UI_PORT;
}

export function setTraceUiPort(port: number, persist = true): number {
	const p = clampPort(port);
	runtimePort = p;
	if (persist) {
		const dir = getProviderTraceRoot();
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(configPath(), JSON.stringify({ port: p }, null, 2), "utf8");
	}
	return p;
}

export function clearRuntimePortOverride(): void {
	runtimePort = null;
}