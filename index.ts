/**
 * pi-provider-trace — raw HTTP + SSE wire capture (hack layer)
 *
 * Default OFF. /trace on (抓包 + 自动开 UI) | /trace ui 仅开 UI
 * Logs per Pi session under provider-trace/sessions/<key>/http-sse.jsonl
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { applySessionFromCtx, getActiveSession } from "./session-context.js";
import { sessionLogPath } from "./session-registry.js";
import {
	getTraceLogDir,
	isTraceEnabled,
	setTraceEnabled,
	setTraceLogDir,
	writeTrace,
} from "./logger.js";
import { installFetchTrace, isFetchTraceInstalled, uninstallFetchTrace } from "./trace-fetch.js";
import { attachPiEventTrace } from "./pi-events.js";
import { DEFAULT_TRACE_UI_PORT, getTraceUiPort, setTraceUiPort } from "./trace-config.js";
import { getTraceUiUrl, openBrowser, startTraceWebUi, stopTraceWebUi } from "./web-ui.js";

function defaultLogDir(): string {
	return join(getAgentDir(), "provider-trace");
}

function applyTracing(on: boolean, ctx?: ExtensionContext): void {
	setTraceLogDir(defaultLogDir());
	if (ctx) applySessionFromCtx(ctx);
	setTraceEnabled(on);
	if (on) {
		installFetchTrace();
		const s = getActiveSession();
		writeTrace({
			ts: new Date().toISOString(),
			kind: "response_meta",
			id: "session",
			sessionKey: s.key,
			sessionLabel: s.label,
			message: "pi-provider-trace enabled (fetch patch active)",
		});
	} else {
		uninstallFetchTrace();
	}
}

async function openTraceUi(ctx: ExtensionContext): Promise<string | null> {
	try {
		const url = await startTraceWebUi();
		try {
			await openBrowser(url);
		} catch {
			ctx.ui.notify("请手动打开浏览器: " + url, "warning");
		}
		return url;
	} catch (err) {
		ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
		return null;
	}
}

function statusLine(): string {
	const on = isTraceEnabled() && isFetchTraceInstalled();
	const dir = getTraceLogDir() ?? defaultLogDir();
	const ui = getTraceUiUrl();
	const uiPart = ui ? ` | UI ${ui}` : "";
	return on ? `ON → ${dir}/sessions/…${uiPart}` : "OFF";
}

export default function piProviderTrace(pi: ExtensionAPI) {
	pi.registerFlag("trace", {
		description: "Enable provider HTTP/SSE trace and open Web UI on startup (same as /trace on)",
		type: "boolean",
		default: false,
	});

	attachPiEventTrace(pi);

	const syncSession = (_event: unknown, ctx: ExtensionContext) => {
		applySessionFromCtx(ctx);
	};

	pi.on("session_start", async (_event, ctx) => {
		syncSession(_event, ctx);
		if (process.argv.includes("--mode") && process.argv.includes("rpc")) return;
		if (!pi.getFlag("trace")) return;
		applyTracing(true, ctx);
		const url = await openTraceUi(ctx);
		const uiLine = url ? `\nUI ${url}` : "";
		ctx.ui.notify(`provider trace ${statusLine()}${uiLine}`, "info");
	});
	pi.on("session_switch", syncSession);

	pi.on("session_shutdown", async () => {
		await stopTraceWebUi();
		if (isFetchTraceInstalled()) uninstallFetchTrace();
		setTraceEnabled(false);
	});

	const traceSubcommandCompletions = (
		prefix: string,
	): Array<{ value: string; label: string; description?: string }> | null => {
		const raw = prefix.trimStart();
		const lower = raw.toLowerCase();
		if (lower.includes(" ")) {
			if (lower.startsWith("port ")) {
				const portPrefix = lower.slice(5).trim();
				const ports = [String(DEFAULT_TRACE_UI_PORT), "33000", "8080"];
				const filtered = ports.filter((p) => p.startsWith(portPrefix));
				return filtered.length > 0
					? filtered.map((p) => ({ value: p, label: p, description: "UI port" }))
					: null;
			}
			return null;
		}
		const subs = [
			{ value: "on", label: "on", description: "抓包 + 自动开 Web UI" },
			{ value: "off", label: "off", description: "关闭抓包" },
			{ value: "ui", label: "ui", description: "打开 Web UI" },
			{ value: "path", label: "path", description: "日志根目录" },
			{ value: "port", label: "port", description: "查看/设置 UI 端口" },
		];
		const filtered = subs.filter((s) => s.value.startsWith(lower));
		return filtered.length > 0 ? filtered : null;
	};

	pi.registerCommand("trace", {
		description: "Provider HTTP/SSE trace: on | off | ui | path | port",
		getArgumentCompletions: traceSubcommandCompletions,
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const sub = (parts[0] ?? "").toLowerCase();

			if (sub === "on" || sub === "enable" || sub === "1") {
				applyTracing(true, ctx);
				const url = await openTraceUi(ctx);
				const uiLine = url ? `\nUI ${url}` : "";
				ctx.ui.notify(`provider trace ${statusLine()}${uiLine}`, "info");
				return;
			}
			if (sub === "off" || sub === "disable" || sub === "0") {
				applyTracing(false, ctx);
				ctx.ui.notify("provider trace OFF", "info");
				return;
			}
			if (sub === "ui" || sub === "web" || sub === "open") {
				const url = await openTraceUi(ctx);
				if (url) ctx.ui.notify(`trace UI: ${url}`, "info");
				return;
			}
			if (sub === "path" || sub === "dir") {
				ctx.ui.notify(getTraceLogDir() ?? defaultLogDir(), "info");
				return;
			}

			if (sub === "port") {
				const arg = parts[1];
				if (!arg) {
					ctx.ui.notify(
						`UI 端口: ${getTraceUiPort()} (默认 ${DEFAULT_TRACE_UI_PORT})\n/trace port <1024-65535>\nenv PI_PROVIDER_TRACE_UI_PORT\n~/.pi/agent/provider-trace/ui-config.json`,
						"info",
					);
					return;
				}
				const n = Number(arg);
				if (!Number.isFinite(n)) {
					ctx.ui.notify("无效端口", "error");
					return;
				}
				const p = setTraceUiPort(n, true);
				ctx.ui.notify(`UI 端口已设为 ${p}，下次 /trace on 或 /trace ui 生效`, "info");
				return;
			}

			ctx.ui.notify(`trace: ${statusLine()}\n/trace on | ui | off | path | port`, "info");
		},
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!isTraceEnabled()) return;
		const s = applySessionFromCtx(ctx);
		const dir = defaultLogDir();
		const logFile = join(dir, "sessions", s.key, "provider-payload.jsonl");
		try {
			const parent = join(dir, "sessions", s.key);
			if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
			appendFileSync(
				logFile,
				`${JSON.stringify({ ts: new Date().toISOString(), cwd: ctx.cwd, sessionKey: s.key, payload: event.payload })}\n`,
				"utf8",
			);
		} catch {
			// ignore
		}
	});
}