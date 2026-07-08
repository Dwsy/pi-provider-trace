import { el } from "../core/dom.js";
import { fmtMs } from "../lib/format.js";
import { t } from "../core/i18n.js";

function statCard(label, value, hint) {
  const card = el("div", { className: "overview-stat" });
  card.append(el("div", { className: "overview-stat-label" }, [label]));
  card.append(el("div", { className: "overview-stat-value" }, [value]));
  if (hint) card.append(el("div", { className: "overview-stat-hint" }, [hint]));
  return card;
}

export function MetricHero(trace) {
  if (!trace) return el("div");
  const cost = (trace.totalCost || 0) > 0 ? "$" + trace.totalCost.toFixed(4) : "—";
  const cachePct =
    trace.cacheHitRate != null && !Number.isNaN(trace.cacheHitRate)
      ? (trace.cacheHitRate * 100).toFixed(0) + "%"
      : null;

  const section = el("section", { className: "overview-summary" });
  section.append(el("h2", { className: "overview-heading" }, [t("overviewTitle")]));
  section.append(
    el("p", { className: "overview-lead" }, [
      t("overviewLead", {
        gens: String(trace.generationCount || 0),
        tokens: String(trace.totalTokens || 0),
      }),
    ]),
  );

  const grid = el("div", { className: "overview-stat-grid" });
  grid.append(
    statCard(t("colCost"), cost, t("overviewHintCost")),
    statCard(t("colLatency"), fmtMs(trace.latencyMs), t("overviewHintLatency")),
    statCard(
      t("colTotal"),
      String(trace.totalTokens || 0),
      (trace.inputTokens || 0) + " in · " + (trace.outputTokens || 0) + " out",
    ),
    statCard(
      t("colGenerations"),
      String(trace.generationCount || 0),
      (trace.errorCount || 0) > 0 ? t("overviewErrors", { n: trace.errorCount }) : t("overviewHintGens"),
    ),
  );
  section.append(grid);

  if (cachePct) {
    section.append(el("p", { className: "overview-footnote" }, [t("overviewCache", { pct: cachePct })]));
  }
  return section;
}

export function TraceDetailCard(trace) {
  if (!trace) return el("div");
  const cost = (trace.totalCost || 0) > 0 ? "$" + trace.totalCost.toFixed(4) : "—";
  const div = el("div", { className: "panel-bone overview-details" });
  div.append(el("h3", {}, [t("overviewDetailsTitle")]));
  const rows = el("dl", { className: "overview-dl" });
  const add = (term, desc) => {
    rows.append(el("dt", {}, [term]), el("dd", {}, [String(desc)]));
  };
  add(t("colInput"), trace.inputTokens || 0);
  add(t("colOutput"), trace.outputTokens || 0);
  add(t("colSpans"), trace.spanCount || 0);
  add(t("colErrors"), trace.errorCount || 0);
  add(t("colCost"), cost);
  if (trace.scores?.scoresAvg != null) add(t("scoreAvg"), trace.scores.scoresAvg.toFixed(2));
  div.append(rows);
  return div;
}