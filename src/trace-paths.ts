import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** Trace logs + UI config under ~/.pi/provider-trace (sibling of agent dir). */
export function getProviderTraceRoot(): string {
	return join(dirname(getAgentDir()), "provider-trace");
}