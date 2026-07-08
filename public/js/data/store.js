export const exchanges = new Map();
export const timelineEntries = [];

export function ensureExchange(id) {
  if (!exchanges.has(id)) {
    exchanges.set(id, { id, request: null, response: null, sse: [], errors: [], lastTs: null, sessionKey: null, usage: null });
  }
  return exchanges.get(id);
}

export const seenTimelineKeys = new Set();

export function clearStore() {
  exchanges.clear();
  timelineEntries.length = 0;
  seenTimelineKeys.clear();
}
