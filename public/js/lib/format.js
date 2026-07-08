export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return Math.round(ms) + " ms";
  return (ms / 1000).toFixed(2) + " s";
}

export function fmtNum(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.round(n * 100) / 100);
}

export function prettyJson(str) {
  if (!str) return "";
  try { return JSON.stringify(JSON.parse(str), null, 2); } catch { return str; }
}

export function shortUrl(url, noUrlLabel) {
  if (!url) return noUrlLabel;
  try {
    const u = new URL(url);
    const p = u.pathname;
    return p.length > 44 ? p.slice(0, 44) + "…" : p;
  } catch {
    return url.slice(0, 48);
  }
}
