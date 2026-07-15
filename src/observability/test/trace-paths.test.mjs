import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { getProviderTraceRoot } from "../../trace-paths.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(process.cwd(), ".pi", "agent");

try {
	assert.equal(getProviderTraceRoot(), join(homedir(), ".pi", "provider-trace"));
	console.log("trace-paths.test.mjs ok");
} finally {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
}
