import assert from "node:assert/strict";
import {
	OVERVIEW_DEFAULT_LIMIT,
	OVERVIEW_MAX_LIMIT,
	buildOverview,
	isOverviewWindow,
	parseOverviewLimit,
} from "../overview.ts";

const NOW = new Date("2026-03-10T12:30:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

function iso(base, offsetMs = 0) {
	return new Date(Date.parse(base) + offsetMs).toISOString();
}

function usageOf({ provider, model, input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0 }) {
	return {
		provider,
		model,
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		costTotal: cost,
		costInput: cost,
		costOutput: 0,
		costCacheRead: 0,
		costCacheWrite: 0,
		cacheHitRate: input + cacheRead > 0 ? cacheRead / (input + cacheRead) : 0,
		source: "sse",
	};
}

/** One exchange shaped the way the capture path writes it. */
function exchange({ id, at, url, ttftMs, durationMs, usage, errors = 0 }) {
	const records = [{ ts: at, kind: "request", id, url, method: "POST" }];
	if (ttftMs != null && durationMs != null) {
		records.push({
			ts: iso(at, durationMs),
			kind: "stream_result",
			id,
			url,
			stream: {
				state: "complete",
				text: "ok",
				reasoning: "",
				toolCalls: [],
				eventCount: 2,
				byteCount: 8,
				firstEventTs: iso(at, ttftMs),
				lastEventTs: iso(at, durationMs),
			},
		});
	}
	for (let i = 0; i < errors; i += 1) {
		records.push({ ts: iso(at, 1), kind: "error", id, message: "boom" });
	}
	if (usage) {
		records.push({ ts: iso(at, (durationMs ?? 0) + 5), kind: "llm_usage", id, url, usage });
	}
	return records;
}

function session(key, ...exchanges) {
	return { key, label: key, records: exchanges.flat() };
}

function overview(sessions, window, limit = 50) {
	return buildOverview({ sessions, window, limit, now: NOW });
}

// --- request parsing -------------------------------------------------------

assert.equal(isOverviewWindow("24h"), true);
assert.equal(isOverviewWindow("7d"), true);
assert.equal(isOverviewWindow("30d"), true);
assert.equal(isOverviewWindow("all"), true);
assert.equal(isOverviewWindow("1h"), false);
assert.equal(isOverviewWindow(""), false);

assert.equal(parseOverviewLimit(null), OVERVIEW_DEFAULT_LIMIT);
assert.equal(parseOverviewLimit(""), OVERVIEW_DEFAULT_LIMIT);
assert.equal(parseOverviewLimit("10"), 10);
assert.equal(parseOverviewLimit("9999"), OVERVIEW_MAX_LIMIT);
assert.strictEqual(parseOverviewLimit("0"), null);
assert.strictEqual(parseOverviewLimit("-5"), null);
assert.strictEqual(parseOverviewLimit("abc"), null);
assert.strictEqual(parseOverviewLimit("1.5"), null);

// --- window filtering ------------------------------------------------------
// Costs are powers of two so that summed money compares exactly.

const sessionA = session(
	"a",
	exchange({
		id: "a1",
		at: "2026-03-10T10:00:00.000Z",
		url: "https://api.anthropic.com/v1/messages",
		ttftMs: 1000,
		durationMs: 3000,
		usage: usageOf({ provider: "anthropic", model: "claude-x", input: 100, output: 50, cacheRead: 20, cost: 0.5 }),
	}),
	exchange({
		id: "a2",
		at: "2026-03-01T10:00:00.000Z",
		url: "https://api.openai.com/v1/responses",
		ttftMs: 2000,
		durationMs: 4000,
		usage: usageOf({ provider: "openai", model: "gpt-y", input: 10, output: 5, cost: 0.0625 }),
	}),
);
const sessionB = session(
	"b",
	exchange({
		id: "b1",
		at: "2026-02-20T08:00:00.000Z",
		url: "https://generativelanguage.googleapis.com/v1/models",
		ttftMs: 500,
		durationMs: 1500,
		usage: usageOf({ provider: "google", model: "gemini-z", input: 30, output: 10, cost: 0.25 }),
	}),
	exchange({
		id: "b2",
		at: "2026-02-20T09:00:00.000Z",
		url: "https://api.anthropic.com/v1/messages",
		ttftMs: 700,
		durationMs: 2700,
		usage: usageOf({ provider: "anthropic", model: "claude-w", input: 20, output: 5, cost: 0.125 }),
	}),
);
const twoSessions = [sessionA, sessionB];

const day = overview(twoSessions, "24h");
assert.equal(day.generatedAt, NOW.toISOString());
assert.equal(day.windowStart, "2026-03-09T12:30:00.000Z");
assert.equal(day.scanned.included, 1);
assert.equal(day.totals.generations, 1);
assert.equal(day.totals.totalTokens, 170);

// A session inside the window still drops its own out-of-window exchanges.
const week = overview(twoSessions, "7d");
assert.equal(week.windowStart, "2026-03-03T12:30:00.000Z");
assert.equal(week.scanned.included, 1);
assert.equal(week.totals.generations, 1);
assert.equal(week.totals.totalTokens, 170);

const month = overview(twoSessions, "30d");
assert.equal(month.windowStart, "2026-02-08T12:30:00.000Z");
assert.equal(month.scanned.included, 2);
assert.equal(month.totals.generations, 4);
assert.equal(month.totals.totalTokens, 250);

const all = overview(twoSessions, "all");
assert.strictEqual(all.windowStart, null);
assert.equal(all.totals.generations, 4);
assert.equal(all.totals.exchanges, 4);
assert.equal(all.totals.totalCost, 0.9375);
assert.deepEqual(all.scanned, { sessions: 2, included: 2, bytes: 0, truncated: false, durationMs: 0 });

const scanned = buildOverview({
	sessions: twoSessions,
	window: "all",
	limit: 50,
	now: NOW,
	scan: { sessions: 5, bytes: 1234, truncated: true, durationMs: 7 },
});
assert.deepEqual(scanned.scanned, { sessions: 5, included: 2, bytes: 1234, truncated: true, durationMs: 7 });

// --- per-model and per-provider rollups ------------------------------------

assert.deepEqual(all.models.map((entry) => entry.key), [
	"anthropic/claude-x",
	"google/gemini-z",
	"anthropic/claude-w",
	"openai/gpt-y",
]);
const claudeX = all.models[0];
assert.equal(claudeX.provider, "anthropic");
assert.equal(claudeX.model, "claude-x");
assert.equal(claudeX.generations, 1);
assert.equal(claudeX.inputTokens, 100);
assert.equal(claudeX.outputTokens, 50);
assert.equal(claudeX.cacheReadTokens, 20);
assert.equal(claudeX.totalTokens, 170);
assert.equal(claudeX.totalCost, 0.5);
assert.equal(claudeX.avgTtftMs, 1000);
assert.equal(claudeX.p95TtftMs, 1000);
assert.equal(claudeX.sessions, 1);

assert.deepEqual(all.providers.map((entry) => entry.provider), ["anthropic", "google", "openai"]);
const anthropic = all.providers[0];
assert.equal(anthropic.generations, 2);
assert.equal(anthropic.totalTokens, 195);
assert.equal(anthropic.totalCost, 0.625);
assert.equal(anthropic.avgTtftMs, 850);
assert.equal(anthropic.sessions, 2);
assert.equal(anthropic.models, 2);

// Session rows keep first-seen model order, which follows exchange time.
assert.deepEqual(all.sessions.map((entry) => entry.key), ["a", "b"]);
const rowA = all.sessions[0];
assert.equal(rowA.lastTs, "2026-03-10T10:00:03.005Z");
assert.equal(rowA.generations, 2);
assert.equal(rowA.totalTokens, 185);
assert.equal(rowA.totalCost, 0.5625);
assert.equal(rowA.avgTtftMs, 1500);
assert.equal(rowA.avgLatencyMs, 3500);
assert.deepEqual(rowA.models, ["openai/gpt-y", "anthropic/claude-x"]);

// --- nearest-rank percentiles ----------------------------------------------
// Deliberately unsorted input; the fold has to sort before ranking.

const spread = overview(
	[
		session(
			"p",
			...[
				["p1", 300, 3000],
				["p2", 100, 1000],
				["p3", 400, 4000],
				["p4", 200, 2000],
			].map(([id, ttftMs, durationMs], index) =>
				exchange({
					id,
					at: iso("2026-03-10T08:00:00.000Z", index * 10 * 60 * 1000),
					ttftMs,
					durationMs,
					usage: usageOf({ provider: "openai", model: "gpt-y", input: 1, output: 1 }),
				}),
			),
		),
	],
	"24h",
);
assert.equal(spread.totals.avgTtftMs, 250);
assert.equal(spread.totals.p50TtftMs, 200);
assert.equal(spread.totals.p95TtftMs, 400);
assert.equal(spread.totals.avgLatencyMs, 2500);
assert.equal(spread.totals.p95LatencyMs, 4000);

// Output throughput uses streaming seconds, not total latency.
const throughput = overview(
	[
		session(
			"t",
			exchange({
				id: "t1",
				at: "2026-03-10T08:00:00.000Z",
				ttftMs: 1000,
				durationMs: 3000,
				usage: usageOf({ provider: "openai", model: "gpt-y", input: 10, output: 100 }),
			}),
		),
	],
	"24h",
);
assert.equal(throughput.totals.avgOutputTps, 50);

// --- null versus zero -------------------------------------------------------

const unmeasured = overview(
	[
		session(
			"n",
			exchange({
				id: "n1",
				at: "2026-03-10T09:00:00.000Z",
				usage: usageOf({ provider: "openai", model: "gpt-y", input: 5, output: 5 }),
			}),
		),
	],
	"24h",
);
assert.equal(unmeasured.totals.generations, 1);
assert.equal(unmeasured.totals.totalTokens, 10);
assert.strictEqual(unmeasured.totals.avgTtftMs, null);
assert.strictEqual(unmeasured.totals.p50TtftMs, null);
assert.strictEqual(unmeasured.totals.p95TtftMs, null);
assert.strictEqual(unmeasured.totals.avgLatencyMs, null);
assert.strictEqual(unmeasured.totals.p95LatencyMs, null);
assert.strictEqual(unmeasured.totals.avgOutputTps, null);
assert.equal(unmeasured.totals.cacheHitRate, 0);

// A measured zero must survive as 0, because the UI renders null very differently.
const instant = overview(
	[
		session(
			"z",
			exchange({
				id: "z1",
				at: "2026-03-10T09:00:00.000Z",
				ttftMs: 0,
				durationMs: 1000,
				usage: usageOf({ provider: "openai", model: "gpt-y", input: 5, output: 5 }),
			}),
		),
	],
	"24h",
);
assert.strictEqual(instant.totals.avgTtftMs, 0);
assert.strictEqual(instant.totals.p50TtftMs, 0);
assert.strictEqual(instant.totals.p95TtftMs, 0);

// --- cache accounting -------------------------------------------------------

const cached = overview(
	[
		session(
			"c",
			exchange({
				id: "c1",
				at: "2026-03-10T09:00:00.000Z",
				ttftMs: 100,
				durationMs: 1000,
				usage: usageOf({ provider: "openai", model: "gpt-y", input: 30, output: 5, cacheRead: 10, cacheWrite: 7 }),
			}),
		),
	],
	"24h",
);
assert.equal(cached.totals.inputTokens, 30);
assert.equal(cached.totals.outputTokens, 5);
assert.equal(cached.totals.cacheReadTokens, 10);
assert.equal(cached.totals.cacheWriteTokens, 7);
assert.equal(cached.totals.cacheHitRate, 0.25);

// --- gap-filled hourly buckets ----------------------------------------------

const hourly = overview(
	[
		session(
			"h",
			exchange({
				id: "h1",
				at: "2026-03-10T09:15:00.000Z",
				ttftMs: 100,
				durationMs: 1000,
				usage: usageOf({ provider: "openai", model: "gpt-y", input: 4, output: 6 }),
			}),
			exchange({
				id: "h2",
				at: "2026-03-10T11:45:00.000Z",
				ttftMs: 300,
				durationMs: 1000,
				usage: usageOf({ provider: "openai", model: "gpt-y", input: 4, output: 6 }),
			}),
		),
	],
	"24h",
);
assert.equal(hourly.timeline.length, 25);
assert.equal(hourly.timeline[0].bucket, "2026-03-09T12:00:00.000Z");
assert.equal(hourly.timeline.at(-1).bucket, "2026-03-10T12:00:00.000Z");
for (let i = 1; i < hourly.timeline.length; i += 1) {
	const step = Date.parse(hourly.timeline[i].bucket) - Date.parse(hourly.timeline[i - 1].bucket);
	assert.equal(step, HOUR_MS);
}
const busyHour = hourly.timeline.find((entry) => entry.bucket === "2026-03-10T09:00:00.000Z");
assert.equal(busyHour.generations, 1);
assert.equal(busyHour.totalTokens, 10);
assert.equal(busyHour.avgTtftMs, 100);
const idleHour = hourly.timeline.find((entry) => entry.bucket === "2026-03-10T10:00:00.000Z");
assert.equal(idleHour.generations, 0);
assert.equal(idleHour.errors, 0);
assert.equal(idleHour.totalTokens, 0);
assert.equal(idleHour.totalCost, 0);
assert.strictEqual(idleHour.avgTtftMs, null);

// --- gap-filled daily buckets -----------------------------------------------

const daily = overview(
	[
		session(
			"d",
			exchange({
				id: "d1",
				at: "2026-03-04T08:00:00.000Z",
				ttftMs: 100,
				durationMs: 1000,
				usage: usageOf({ provider: "openai", model: "gpt-y", input: 4, output: 6 }),
			}),
			exchange({
				id: "d2",
				at: "2026-03-08T08:00:00.000Z",
				ttftMs: 100,
				durationMs: 1000,
				usage: usageOf({ provider: "openai", model: "gpt-y", input: 4, output: 6 }),
			}),
		),
	],
	"7d",
);
assert.equal(daily.timeline.length, 8);
assert.equal(daily.timeline[0].bucket, "2026-03-03T00:00:00.000Z");
assert.equal(daily.timeline.at(-1).bucket, "2026-03-10T00:00:00.000Z");
const idleDay = daily.timeline.find((entry) => entry.bucket === "2026-03-06T00:00:00.000Z");
assert.equal(idleDay.generations, 0);
assert.strictEqual(idleDay.avgTtftMs, null);

// The open window spans the data it actually has rather than all of history.
assert.equal(all.timeline.length, 19);
assert.equal(all.timeline[0].bucket, "2026-02-20T00:00:00.000Z");
assert.equal(all.timeline.at(-1).bucket, "2026-03-10T00:00:00.000Z");

const empty = overview([], "all");
assert.deepEqual(empty.timeline, []);
assert.deepEqual(empty.sessions, []);
assert.equal(empty.totals.generations, 0);
assert.equal(empty.totals.cacheHitRate, 0);
assert.strictEqual(empty.totals.avgTtftMs, null);

// --- limit caps the session list, never the aggregates ----------------------

const capped = buildOverview({
	sessions: ["s1", "s2", "s3"].map((key, index) =>
		session(
			key,
			exchange({
				id: `${key}-1`,
				at: iso("2026-03-10T06:00:00.000Z", index * HOUR_MS),
				ttftMs: 100,
				durationMs: 1000,
				usage: usageOf({ provider: "openai", model: "gpt-y", input: 5, output: 5, cost: 0.25 }),
			}),
		),
	),
	window: "24h",
	limit: 1,
	now: NOW,
});
assert.equal(capped.sessions.length, 1);
assert.equal(capped.sessions[0].key, "s3");
assert.equal(capped.scanned.included, 3);
assert.equal(capped.totals.generations, 3);
assert.equal(capped.totals.totalTokens, 30);
assert.equal(capped.totals.totalCost, 0.75);
assert.equal(capped.models.length, 1);
assert.equal(capped.models[0].sessions, 3);
assert.equal(capped.providers[0].sessions, 3);

// --- unresolvable model identity --------------------------------------------

const unresolved = overview(
	[
		session(
			"u",
			exchange({
				id: "u1",
				at: "2026-03-10T07:00:00.000Z",
				url: "http://localhost:3838/v1/chat/completions",
				ttftMs: 100,
				durationMs: 1000,
				usage: usageOf({ provider: "openai", input: 1, output: 1 }),
			}),
			exchange({
				id: "u2",
				at: "2026-03-10T07:10:00.000Z",
				url: "http://localhost:3838/v1/chat/completions",
				ttftMs: 100,
				durationMs: 1000,
				usage: usageOf({ input: 1, output: 1 }),
			}),
			exchange({ id: "u3", at: "2026-03-10T07:20:00.000Z", errors: 1 }),
		),
	],
	"24h",
);
assert.deepEqual(unresolved.models.map((entry) => entry.key), [
	"localhost:3838/unknown",
	"openai/unknown",
	"unknown/unknown",
]);
assert.equal(unresolved.totals.exchanges, 3);
assert.equal(unresolved.totals.generations, 2);
assert.equal(unresolved.totals.errors, 1);
const failed = unresolved.models.find((entry) => entry.key === "unknown/unknown");
assert.equal(failed.generations, 0);
assert.equal(failed.errors, 1);

// --- legacy sse_line captures still aggregate --------------------------------

const legacyAt = "2026-03-10T05:00:00.000Z";
const legacy = overview(
	[
		{
			key: "legacy",
			label: "legacy",
			records: [
				{ ts: legacyAt, kind: "request", id: "l1", url: "https://api.openai.com/v1/chat/completions", method: "POST" },
				{ ts: iso(legacyAt, 1000), kind: "sse_line", id: "l1", line: 'data: {"choices":[{"delta":{"content":"hello "}}]}' },
				{ ts: iso(legacyAt, 2000), kind: "sse_line", id: "l1", line: 'data: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}]}' },
				{ ts: iso(legacyAt, 2500), kind: "sse_line", id: "l1", line: "data: [DONE]" },
				{
					ts: iso(legacyAt, 2600),
					kind: "llm_usage",
					id: "l1",
					usage: usageOf({ provider: "openai", model: "gpt-4o", input: 40, output: 60, cost: 0.5 }),
				},
			],
		},
	],
	"24h",
);
assert.equal(legacy.totals.exchanges, 1);
assert.equal(legacy.totals.generations, 1);
assert.equal(legacy.totals.totalTokens, 100);
assert.equal(legacy.totals.totalCost, 0.5);
assert.equal(legacy.totals.avgTtftMs, 1000);
assert.equal(legacy.totals.avgLatencyMs, 2500);
assert.equal(legacy.totals.avgOutputTps, 40);
assert.deepEqual(legacy.models.map((entry) => entry.key), ["openai/gpt-4o"]);

console.log("overview.test.mjs: ok");
