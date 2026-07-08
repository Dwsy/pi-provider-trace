import { basename } from "node:path";

export type ActiveSession = {
	key: string;
	label: string;
};

let active: ActiveSession = { key: "unsaved", label: "unsaved" };

export function sanitizeSessionKey(raw: string): string {
	const s = raw.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_").slice(0, 120);
	return s || "session";
}

export function setActiveSession(key: string, label: string): void {
	active = { key: sanitizeSessionKey(key), label: label || key };
}

export function getActiveSession(): ActiveSession {
	return active;
}

type SessionManagerSlice = {
	getSessionName(): string | undefined;
	getSessionFile(): string | undefined;
	getSessionId(): string;
};

/** Resolve Pi session identity from extension context (sessionManager, not ctx.getSessionName). */
export function resolveSessionFromCtx(ctx: { cwd: string; sessionManager: SessionManagerSlice }): ActiveSession {
	const sm = ctx.sessionManager;
	const displayName = sm.getSessionName();
	const file = sm.getSessionFile();

	let key: string;
	let label: string;

	if (file) {
		const base = basename(file);
		const stem = base.endsWith(".jsonl") ? base.slice(0, -6) : base;
		key = sanitizeSessionKey(stem);
		label = displayName?.trim() || "";
	} else if (sm.getSessionId()) {
		key = sanitizeSessionKey(sm.getSessionId());
		label = displayName?.trim() || "";
	} else {
		key = sanitizeSessionKey(`cwd-${ctx.cwd}`);
		label = displayName?.trim() || "";
	}

	return { key, label };
}

export function applySessionFromCtx(ctx: { cwd: string; sessionManager: SessionManagerSlice }): ActiveSession {
	const s = resolveSessionFromCtx(ctx);
	setActiveSession(s.key, s.label);
	return s;
}