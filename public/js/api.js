async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

export function fetchSessions(signal) {
  return jsonRequest("/api/sessions", { signal });
}

export function fetchStatus(signal) {
  return jsonRequest("/api/status", { signal });
}

export function fetchHistory(sessionKey, signal) {
  const url = `/api/history?session=${encodeURIComponent(sessionKey)}&limit=5000`;
  return jsonRequest(url, { signal });
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
  const source = new EventSource(`/api/stream?session=${encodeURIComponent(sessionKey)}`);
  source.onopen = () => handlers.open?.();
  source.onerror = () => handlers.error?.();
  source.onmessage = (event) => {
    try { handlers.record?.(JSON.parse(event.data)); } catch {}
  };
  return () => source.close();
}
