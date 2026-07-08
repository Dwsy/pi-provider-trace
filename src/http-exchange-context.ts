/** Correlate in-flight HTTP fetch with usage records (same exchange id). */

let activeExchangeId: string | null = null;

export function setActiveExchangeId(id: string | null): void {
	activeExchangeId = id;
}

export function getActiveExchangeId(): string | null {
	return activeExchangeId;
}