import { homedir } from "node:os";
import { join } from "node:path";

/** Trace logs + UI config are user-global and independent of the active project. */
export function getProviderTraceRoot(): string {
	return join(homedir(), ".pi", "provider-trace");
}
