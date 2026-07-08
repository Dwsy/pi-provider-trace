/** Human labels for HTTP exchanges (no cryptic id truncation). */

export function parseHttpUrl(url) {
  if (!url) return { host: "", path: "—", full: "" };
  try {
    const u = new URL(url);
    return { host: u.host, path: u.pathname + u.search, full: url };
  } catch {
    return { host: "", path: String(url), full: String(url) };
  }
}

export function exchangePathLabel(url, maxPath = 56) {
  const { host, path } = parseHttpUrl(url);
  if (!host && path === "—") return "—";
  const p = path.length > maxPath ? path.slice(0, maxPath) + "…" : path;
  return host ? host + p : p;
}

export function exchangeRowTitle(method, url, noUrl) {
  const m = method || "—";
  const path = exchangePathLabel(url, 72);
  if (path === "—") return m + " " + (noUrl || "");
  return m + " " + path;
}