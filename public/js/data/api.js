import { state } from "../core/state.js";

export async function fetchSessions() {
  const r = await fetch("/api/sessions");
  return r.json();
}

export async function fetchHistory(key, limit = 3000) {
  const r = await fetch("/api/history?session=" + encodeURIComponent(key) + "&limit=" + limit);
  return r.json();
}

export async function fetchMetrics(key) {
  const r = await fetch("/api/metrics?session=" + encodeURIComponent(key));
  if (!r.ok) return null;
  return r.json();
}

export async function fetchStatus() {
  const r = await fetch("/api/status");
  return r.json();
}

export function downloadTrace(key, file) {
  window.open("/api/download?session=" + encodeURIComponent(key) + "&file=" + encodeURIComponent(file), "_blank");
}

export async function deleteTrace(key) {
  await fetch("/api/session?key=" + encodeURIComponent(key), { method: "DELETE" });
}

export async function submitScore(name, value, observationId) {
  if (!state.selectedSessionKey || !name) return;
  await fetch("/api/scores?session=" + encodeURIComponent(state.selectedSessionKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, value: Number(value), observationId: observationId || undefined, dataType: "NUMERIC" }),
  });
}
