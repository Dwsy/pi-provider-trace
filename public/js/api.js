import { historyFixture, overviewFixture, sessionsFixture, statusFixture } from "./fixture.js";

/** Sample data is opt-in per page load so a deployed UI can never invent numbers. */
const FIXTURE_ENABLED = new URLSearchParams(location.search).get("fixture") === "1";

let fixtureUsed = false;

/** True once any response in this page load came from the fixture instead of the server. */
export function fixtureServed() {
  return fixtureUsed;
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

/** Real endpoint first; the fixture only covers a failed fetch while `?fixture=1` is set. */
async function withFixture(request, sample) {
  try {
    return await request();
  } catch (error) {
    if (!FIXTURE_ENABLED || error?.name === "AbortError") throw error;
    fixtureUsed = true;
    return sample();
  }
}

export function fetchSessions(signal) {
  return withFixture(() => jsonRequest("/api/sessions", { signal }), sessionsFixture);
}

export function fetchStatus(signal) {
  return withFixture(() => jsonRequest("/api/status", { signal }), statusFixture);
}

export function fetchHistory(sessionKey, signal) {
  const url = `/api/history?session=${encodeURIComponent(sessionKey)}&limit=5000`;
  return withFixture(() => jsonRequest(url, { signal }), () => historyFixture(sessionKey));
}

export function fetchOverview(windowKey, signal) {
  const url = `/api/overview?window=${encodeURIComponent(windowKey)}&limit=50`;
  return withFixture(() => jsonRequest(url, { signal }), () => overviewFixture(windowKey, 50));
}

export async function fetchMetrics(sessionKey, signal) {
  const url = `/api/metrics?session=${encodeURIComponent(sessionKey)}`;
  try { return await jsonRequest(url, { signal }); } catch { return null; }
}

export function historyDownloadUrl(sessionKey) {
  return `/api/download?session=${encodeURIComponent(sessionKey)}&file=http-sse`;
}

export function historyBatchDownloadUrl(sessionKeys) {
  const query = new URLSearchParams();
  for (const key of sessionKeys) query.append("session", key);
  return `/api/download-batch?${query}`;
}

export async function deleteSession(sessionKey) {
  return jsonRequest(`/api/session?key=${encodeURIComponent(sessionKey)}`, { method: "DELETE" });
}

export function openTraceStream(sessionKey, handlers) {
  // Without a backend the EventSource would reconnect forever; report offline once instead.
  if (FIXTURE_ENABLED && fixtureUsed) {
    handlers.error?.();
    return () => {};
  }
  const source = new EventSource(`/api/stream?session=${encodeURIComponent(sessionKey)}`);
  source.onopen = () => handlers.open?.();
  source.onerror = () => handlers.error?.();
  source.onmessage = (event) => {
    try { handlers.record?.(JSON.parse(event.data)); } catch {}
  };
  return () => source.close();
}
