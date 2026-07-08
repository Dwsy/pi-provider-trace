import { el } from "../core/dom.js";
import { fmtMs } from "../lib/format.js";
import { t } from "../core/i18n.js";
import { createKvTable, appendKvRows } from "../lib/usage-table-dom.js";

function sparkSvg(seed, colorVar) {
  const pts = [];
  let v = (seed % 97) / 97;
  for (let i = 0; i < 24; i++) {
    v = (v * 1.7 + (seed + i) * 0.013) % 1;
    pts.push(`${(i / 23) * 100},${28 - v * 22}`);
  }
  const stroke = colorVar === "ok" ? "var(--accent-ok)" : "var(--accent-live)";
  return `<svg class="metric-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="${stroke}" stroke-width="1.5" points="${pts.join(" ")}"/></svg>`;
}

function tile(label, value, opts = {}) {
  const wrap = el("div", { className: "metric-tile" });
  wrap.append(el("span", { className: "metric-label" }, [label]));
  const val = el("span", { className: "metric-value" + (opts.accent ? " accent-" + opts.accent : "") }, [value]);
  wrap.append(val);
  if (opts.spark) {
    const div = document.createElement("div");
    div.innerHTML = sparkSvg(opts.spark, opts.accent || "live");
    wrap.append(div.firstChild);
  }
  return wrap;
}

export function MetricHero(trace) {
  if (!trace) return el("div");
  const cost = (trace.totalCost || 0) > 0 ? "$" + trace.totalCost.toFixed(4) : "—";
  const seed = (trace.generationCount || 0) * 17 + (trace.totalTokens || 0);
  const hero = el("section", { className: "metric-hero" });
  hero.append(el("div", { className: "metric-hero-eyebrow" }, [t("overviewTitle")]));
  const grid = el("div", { className: "metric-grid" });
  grid.append(
    tile(t("colLatency"), fmtMs(trace.latencyMs), { spark: seed, accent: "live" }),
    tile(t("colTotal"), String(trace.totalTokens || 0), { spark: seed + 3, accent: "ok" }),
    tile(t("colCost"), cost, { spark: seed + 7 }),
    tile(t("colGenerations"), String(trace.generationCount || 0), { spark: seed + 11, accent: "ok" }),
  );
  hero.append(grid);
  return hero;
}

export function TraceDetailCard(trace) {
  if (!trace) return el("div");
  const cost = (trace.totalCost || 0) > 0 ? "$" + trace.totalCost.toFixed(4) : "—";
  const div = el("div", { className: "panel-bone" });
  div.append(el("h3", {}, ["Breakdown"]));
  const table = createKvTable();
  appendKvRows(table, [
    [t("colInput"), trace.inputTokens || 0, t("colOutput"), trace.outputTokens || 0],
    [t("colSpans"), trace.spanCount || 0, t("colErrors"), trace.errorCount || 0],
    [t("colCost"), cost, "scores", trace.scores?.scoresAvg != null ? trace.scores.scoresAvg.toFixed(2) : "—"],
  ]);
  div.append(table);
  return div;
}