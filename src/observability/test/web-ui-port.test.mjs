import assert from "node:assert/strict";
import { createServer } from "node:http";
import { probeTraceUiOnPort } from "../../web-ui.ts";

const port = 37654;

const fake = createServer((req, res) => {
	if (req.url === "/api/status") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ traceEnabled: false, port }));
		return;
	}
	res.writeHead(404);
	res.end();
});

await new Promise((resolve) => fake.listen(port, "127.0.0.1", resolve));
try {
	assert.equal(await probeTraceUiOnPort(port), true);
	assert.equal(await probeTraceUiOnPort(port + 1), false);
	console.log("web-ui-port.test.mjs ok");
} finally {
	await new Promise((resolve) => fake.close(() => resolve()));
}