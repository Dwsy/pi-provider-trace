import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import type { TraceRecord } from "../logger.js";
import { StreamAccumulator } from "../stream-result.js";

/** Bounded tail so one huge session log cannot exhaust memory. */
export const SESSION_LOG_MAX_BYTES = 8 * 1024 * 1024;

export type SessionLogTail = {
	records: TraceRecord[];
	/** Bytes actually read from disk. */
	bytes: number;
	/** True when the log exceeded the cap and its head was skipped. */
	truncated: boolean;
};

/** Reads the bounded tail of a JSONL session log. Throws when the file cannot be read. */
export function readSessionLogTail(path: string): SessionLogTail {
	if (!existsSync(path)) return { records: [], bytes: 0, truncated: false };
	let fd: number | null = null;
	try {
		const size = statSync(path).size;
		const length = Math.min(size, SESSION_LOG_MAX_BYTES);
		const start = Math.max(0, size - length);
		const buffer = Buffer.alloc(length);
		fd = openSync(path, "r");
		readSync(fd, buffer, 0, length, start);
		let raw = buffer.toString("utf8");
		if (start > 0) {
			// The read window lands mid-line, so the first line is a fragment.
			const firstLineEnd = raw.indexOf("\n");
			raw = firstLineEnd >= 0 ? raw.slice(firstLineEnd + 1) : "";
		}
		const records: TraceRecord[] = [];
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			try {
				records.push(JSON.parse(line) as TraceRecord);
			} catch {
				// One torn line must not discard the rest of the log.
			}
		}
		return { records, bytes: length, truncated: start > 0 };
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

/** Compacted tail for the browser-facing routes; an unreadable log reads as empty. */
export function tailJsonl(path: string, maxLines = 800): TraceRecord[] {
	try {
		const { records } = readSessionLogTail(path);
		return compactLegacySseRecords(records).slice(-maxLines);
	} catch {
		return [];
	}
}
