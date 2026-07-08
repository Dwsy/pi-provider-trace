/**
 * pi-provider-trace — raw HTTP + SSE wire capture (hack layer)
 *
 * Default OFF. /trace on (capture + start Web UI) | /trace ui (UI only)
 * Logs per Pi session under ~/.pi/provider-trace/sessions/<key>/http-sse.jsonl
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getProviderTraceRoot } from "./trace-paths.js";
import { applySessionFromCtx, getActiveSession } from "./session-context.js";
import {
	getTraceLogDir,
	isTraceEnabled,
	setTraceEnabled,
	setTraceLogDir,
	writeTrace,
} from "./logger.js";
import { installFetchTrace, isFetchTraceInstalled, uninstallFetchTrace } from "./trace-fetch.js";
import { attachPiEventTrace, detachPiEventTrace } from "./pi-events.js";
import { DEFAULT_TRACE_UI_PORT, getTraceUiPort, setTraceUiPort } from "./trace-config.js";
import { getTraceUiUrl, startTraceWebUi, stopTraceWebUi } from "./web-ui.js";
import { resolveCliLocale } from "./cli-locale.js";
import { t } from "./web-ui-i18n.js";
import { setActiveExchangeId } from "./http-exchange-context.js";

function defaultLogDir(): string {
	return getProviderTraceRoot();
}

function applyTracing(on: boolean, ctx?: ExtensionContext): void {
	setTraceLogDir(defaultLogDir());
	if (ctx) applySessionFromCtx(ctx);
	setTraceEnabled(on);
	if (on) {
		installFetchTrace();
		if (piRef) {
			attachPiEventTrace(piRef);
			attachPayloadHook(piRef);
		}
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
		detachPiEventTrace();
		setActiveExchangeId(null);
	}
}

let piRef: ExtensionAPI | null = null;
let payloadHookAttached = false;

function attachPayloadHook(pi: ExtensionAPI): void {
	if (payloadHookAttached) return;
	payloadHookAttached = true;
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

async function startTraceUiOnly(ctx: ExtensionContext): Promise<string | null> {
	try {
		return await startTraceWebUi();
	} catch (err) {
		const loc = resolveCliLocale();
		const msg = err instanceof Error ? err.message : String(err);
		ctx.ui.notify(t(loc, "cmdTraceUiStartFailed", { message: msg }), "error");
		return null;
	}
}

function statusLine(loc = resolveCliLocale()): string {
	const on = isTraceEnabled() && isFetchTraceInstalled();
	if (!on) return t(loc, "cmdTraceStatusOff");
	const dir = getTraceLogDir() ?? defaultLogDir();
	const ui = getTraceUiUrl();
	const uiPart = ui ? t(loc, "cmdTraceStatusUiSuffix", { url: ui }) : "";
	return t(loc, "cmdTraceStatusOn", { dir, ui: uiPart });
}

const TRACE_SUBS = ["on", "off", "ui", "path", "port"] as const;

function traceSubDescriptions(locale: ReturnType<typeof resolveCliLocale>) {
	return {
		on: t(locale, "cmdTraceSubOn"),
		off: t(locale, "cmdTraceSubOff"),
		ui: t(locale, "cmdTraceSubUi"),
		path: t(locale, "cmdTraceSubPath"),
		port: t(locale, "cmdTraceSubPort"),
	} as const;
}

export default function piProviderTrace(pi: ExtensionAPI) {
	const localeAtLoad = resolveCliLocale();

	pi.registerFlag("trace", {
		description: t(localeAtLoad, "flagTraceDesc"),
		type: "boolean",
		default: false,
	});

	piRef = pi;

	pi.on("session_start", (_event, ctx) => {
		applySessionFromCtx(ctx);
		setActiveExchangeId(null);
		if (process.argv.includes("--mode") && process.argv.includes("rpc")) return;
		if (!pi.getFlag("trace")) return;
		applyTracing(true, ctx);
		void startTraceWebUi().catch(() => {});
	});

	pi.on("session_switch", (_event, ctx) => {
		applySessionFromCtx(ctx);
		setActiveExchangeId(null);
	});

	pi.on("session_shutdown", () => {
		void stopTraceWebUi();
		applyTracing(false);
	});

	const traceSubcommandCompletions = (
		prefix: string,
	): Array<{ value: string; label: string; description?: string }> | null => {
		const loc = resolveCliLocale();
		const desc = traceSubDescriptions(loc);
		const raw = prefix.trimStart();
		const lower = raw.toLowerCase();
		if (lower.includes(" ")) {
			if (lower.startsWith("port ")) {
				const portPrefix = lower.slice(5).trim();
				const ports = [String(DEFAULT_TRACE_UI_PORT), "33000", "8080"];
				const filtered = ports.filter((p) => p.startsWith(portPrefix));
				return filtered.length > 0
					? filtered.map((p) => ({ value: p, label: p, description: t(loc, "cmdTracePortItem") }))
					: null;
			}
			return null;
		}
		const subs = TRACE_SUBS.map((value) => ({
			value,
			label: value,
			description: desc[value],
		}));
		const filtered = subs.filter((s) => s.value.startsWith(lower));
		return filtered.length > 0 ? filtered : null;
	};

	pi.registerCommand("trace", {
		description: t(localeAtLoad, "cmdTraceDesc"),
		getArgumentCompletions: traceSubcommandCompletions,
		handler: async (args, ctx) => {
			const loc = resolveCliLocale();
			const parts = args.trim().split(/\s+/);
			const sub = (parts[0] ?? "").toLowerCase();

			if (sub === "on" || sub === "enable" || sub === "1") {
				applyTracing(true, ctx);
				const url = await startTraceUiOnly(ctx);
				const uiLine = url ? `\n${t(loc, "cmdTraceUiLine", { url })}` : "";
				ctx.ui.notify(`${t(loc, "cmdTraceEnabled", { status: statusLine() })}${uiLine}`, "info");
				return;
			}
			if (sub === "off" || sub === "disable" || sub === "0") {
				applyTracing(false, ctx);
				ctx.ui.notify(t(loc, "cmdTraceDisabled"), "info");
				return;
			}
			if (sub === "ui" || sub === "web" || sub === "open") {
				const url = await startTraceUiOnly(ctx);
				if (url) ctx.ui.notify(t(loc, "cmdTraceUiNotify", { url }), "info");
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
						t(loc, "cmdTracePortShow", {
							port: String(getTraceUiPort()),
							defaultPort: String(DEFAULT_TRACE_UI_PORT),
						}),
						"info",
					);
					return;
				}
				const n = Number(arg);
				if (!Number.isFinite(n)) {
					ctx.ui.notify(t(loc, "cmdTracePortInvalid"), "error");
					return;
				}
				const p = setTraceUiPort(n, true);
				ctx.ui.notify(t(loc, "cmdTracePortSet", { port: String(p) }), "info");
				return;
			}

			ctx.ui.notify(t(loc, "cmdTraceStatusHelp", { status: statusLine() }), "info");
		},
	});

}