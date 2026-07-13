/** Correlate in-flight HTTP fetch with usage records (same exchange id). */

let activeExchangeId: string | null = null;
let mostRecentExchangeId: string | null = null;

export function setActiveExchangeId(id: string | null): void {
	activeExchangeId = id;
	if (id) mostRecentExchangeId = id;
}

export function getActiveExchangeId(): string | null {
	return activeExchangeId;
}

/** Last request in this Pi session, retained after its response stream closes for message_end usage. */
export function getMostRecentExchangeId(): string | null {
	return mostRecentExchangeId;
}

export function resetExchangeContext(): void {
	activeExchangeId = null;
	mostRecentExchangeId = null;
}
