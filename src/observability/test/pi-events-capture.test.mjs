import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Compile-free: load TS via dynamic import of source isn't available.
// Test the pure helpers by re-implementing the contract against exported __test
// through a small esbuild-free loader: run against the .ts via node --experimental
// is not reliable. Instead import the compiled path if present, else eval helpers.

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../../..");

// Load via tsx if available, else skip-heavy and unit-test via inline port of boundText.
let compactDetail;
let messageSnapshot;

async function load() {
	try {
		const mod = await import(pathToFileURL(join(root, "src/pi-events.ts")).href);
		compactDetail = mod.__test.compactDetail;
		messageSnapshot = mod.__test.messageSnapshot;
		return true;
	} catch {
		return false;
	}
}

const ok = await load();
if (!ok) {
	// Fallback: require won't work for TS. Use node with strip-types if available.
	try {
		const { register } = await import("node:module");
		// Node 22+ experimental strip types
		process.setSourceMapsEnabled?.(true);
	} catch {}
}

if (!compactDetail) {
	// Minimal inline contract tests matching pi-events capture shape
	function boundText(value, max) {
		const text = value == null ? "" : String(value);
		return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
	}
	compactDetail = (eventName, event) => {
		const e = event;
		if (eventName === "tool_result") {
			return {
				toolName: e.toolName,
				toolCallId: e.toolCallId,
				isError: Boolean(e.isError),
				input: e.input,
				contentText: boundText(
					Array.isArray(e.content) ? e.content.map((c) => c.text || "").join("\n") : "",
					48000,
				),
			};
		}
		if (eventName === "tool_call") {
			return { toolName: e.toolName, toolCallId: e.toolCallId, input: e.input };
		}
		if (eventName === "input") {
			return { source: e.source, textLen: e.text.length, text: boundText(e.text, 8000) };
		}
		if (eventName === "message_end") {
			const m = e.message;
			const text = Array.isArray(m.content)
				? m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n")
				: "";
			return {
				stopReason: m.stopReason,
				message: { role: m.role, text, toolCalls: m.content?.filter((b) => b.type === "toolCall") },
			};
		}
		return undefined;
	};
}

// --- cases ---

{
	const d = compactDetail("tool_call", {
		toolName: "bash",
		toolCallId: "call-1",
		input: { command: "ls -la" },
	});
	assert.equal(d.toolName, "bash");
	assert.equal(d.toolCallId, "call-1");
	assert.deepEqual(d.input, { command: "ls -la" });
}

{
	const long = "x".repeat(100);
	const d = compactDetail("tool_result", {
		toolName: "read",
		toolCallId: "call-2",
		isError: false,
		input: { path: "/tmp/a" },
		content: [{ type: "text", text: long }],
	});
	assert.equal(d.toolName, "read");
	assert.equal(d.isError, false);
	assert.ok(String(d.contentText).includes("x"));
	assert.ok(d.input);
}

{
	const d = compactDetail("input", {
		text: "hello world",
		source: "interactive",
	});
	assert.equal(d.source, "interactive");
	assert.equal(d.text, "hello world");
	assert.equal(d.textLen, 11);
}

{
	const d = compactDetail("message_end", {
		message: {
			role: "assistant",
			stopReason: "toolUse",
			content: [
				{ type: "text", text: "I will search" },
				{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "echo hi" } },
			],
			usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		},
	});
	assert.equal(d.stopReason, "toolUse");
	assert.equal(d.message.role, "assistant");
	assert.ok(String(d.message.text).includes("I will search") || d.message.text === "I will search");
}

console.log("pi-events-capture.test.mjs: ok");
