import { currentLocale } from "./i18n.js";

export function formatRelative(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "—";
  const delta = Date.now() - time;
  const abs = Math.abs(delta);
  if (abs < 5_000) return currentLocale() === "zh" ? "刚刚" : "now";
  if (abs < 60_000) return `${Math.round(abs / 1_000)}s`;
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h`;
  return new Intl.DateTimeFormat(currentLocale() === "zh" ? "zh-CN" : "en", {
    month: "short", day: "numeric",
  }).format(time);
}

export function formatTimestamp(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "—";
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(time);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

export function formatClock(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "—";
  return new Intl.DateTimeFormat(currentLocale() === "zh" ? "zh-CN" : "en", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(time);
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

export function formatTokens(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "—";
  if (number < 1_000) return String(Math.round(number));
  if (number < 1_000_000) return `${(number / 1_000).toFixed(number < 10_000 ? 1 : 0)}k`;
  return `${(number / 1_000_000).toFixed(1)}m`;
}

/** Output tokens per second; compact mono-friendly form. */
export function formatTps(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "—";
  if (number < 10) return `${number.toFixed(2)}/s`;
  if (number < 100) return `${number.toFixed(1)}/s`;
  return `${Math.round(number)}/s`;
}

export function formatCost(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "—";
  if (number < 0.01) return `$${number.toFixed(4)}`;
  return `$${number.toFixed(2)}`;
}

/**
 * Grouped integer for the overview. Zero is a counted fact there, so it must not
 * collapse into the em dash that means "no sample".
 */
export function formatCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat(currentLocale() === "zh" ? "zh-CN" : "en").format(Math.round(number));
}

/** Compact tokens; unlike formatTokens a measured zero stays "0". */
export function formatTokensMeasured(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number === 0 ? "0" : formatTokens(number);
}

/** Cost; unlike formatCost a measured zero stays "$0.00". */
export function formatCostMeasured(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number === 0 ? "$0.00" : formatCost(number);
}

/** Ratio in percent. Returns null for an undefined denominator so the caller can show the em dash. */
export function formatPercent(numerator, denominator) {
  const top = Number(numerator);
  const bottom = Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return null;
  const percent = (top / bottom) * 100;
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

export function formatBytes(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "0 B";
  if (number < 1_024) return `${number} B`;
  if (number < 1_048_576) return `${(number / 1_024).toFixed(1)} KB`;
  return `${(number / 1_048_576).toFixed(1)} MB`;
}

export function endpointPath(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url || "—";
  }
}

export function prettyJson(value) {
  if (typeof value === "string") {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  try { return JSON.stringify(value, null, 2); } catch { return String(value ?? ""); }
}

export function msBetween(first, last) {
  const a = Date.parse(first || "");
  const b = Date.parse(last || "");
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return undefined;
  return b - a;
}

export function truncate(value, max = 180) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
