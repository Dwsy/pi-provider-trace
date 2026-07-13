import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	_resetTraceWriteStateForTests,
	listLiveTraceRecords,
	setTraceEnabled,
	setTraceLogDir,
	writeTrace,
} from "../../logger.ts";

const tmp = mkdtempSync(join(tmpdir(), "pi-trace-live-"));
const path = join(tmp, "sessions", "s1", "http-sse.jsonl");

function rows() {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

_resetTraceWriteStateForTests();
setTraceLogDir(tmp);
setTraceEnabled(true);

writeTrace({
	ts: "2026-01-01T00:00:01.000Z",
	kind: "stream_update",
	id: "ex1",
	sessionKey: "s1",
	stream: {
		state: "streaming",
		text: "",
		reasoning: "",
		toolCalls: [],
		eventCount: 3,
		byteCount: 120,
	},
	streamDelta: { text: "hel" },
});

assert.equal(existsSync(path), false, "stream_update must never touch disk");
assert.equal(listLiveTraceRecords("s1").length, 1);
assert.equal(listLiveTraceRecords("s1")[0].stream.text, "hel");

writeTrace({
	ts: "2026-01-01T00:00:01.100Z",
	kind: "sse_line",
	id: "legacy",
	sessionKey: "s1",
	line: "data: should-not-persist",
});
assert.equal(existsSync(path), false, "legacy sse_line must also remain live-only");

writeTrace({
	ts: "2026-01-01T00:00:02.000Z",
	kind: "stream_result",
	id: "ex1",
	sessionKey: "s1",
	stream: {
		state: "complete",
		text: "hello",
		reasoning: "",
		toolCalls: [],
		eventCount: 5,
		byteCount: 240,
		firstEventTs: "2026-01-01T00:00:01.000Z",
		lastEventTs: "2026-01-01T00:00:02.000Z",
		finishReason: "stop",
	},
});

assert.equal(listLiveTraceRecords("s1").length, 0, "final result evicts the transient snapshot");
assert.equal(rows().length, 1, "one stream produces one durable result row");
assert.equal(rows()[0].kind, "stream_result");
assert.equal(rows()[0].stream.text, "hello");
assert.equal(rows().some((row) => row.kind === "sse_line" || row.kind === "stream_update"), false);

setTraceEnabled(false);
_resetTraceWriteStateForTests();
rmSync(tmp, { recursive: true, force: true });
console.log("logger-stream.test.mjs: ok");
