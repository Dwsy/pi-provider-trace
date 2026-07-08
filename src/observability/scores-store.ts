import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScoreEvent } from "./types.js";

function scoresPath(logDir: string, sessionKey: string): string {
	return join(logDir, "sessions", sessionKey, "scores.jsonl");
}

export function appendScore(logDir: string, sessionKey: string, score: ScoreEvent): void {
	const dir = join(logDir, "sessions", sessionKey);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	appendFileSync(scoresPath(logDir, sessionKey), JSON.stringify(score) + "\n", "utf8");
}

export function listScores(logDir: string, sessionKey: string, limit = 200): ScoreEvent[] {
	const path = scoresPath(logDir, sessionKey);
	if (!existsSync(path)) return [];
	const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
	const out: ScoreEvent[] = [];
	for (const line of lines.slice(-limit)) {
		try {
			out.push(JSON.parse(line) as ScoreEvent);
		} catch {
			// skip
		}
	}
	return out;
}
