import { state } from "../core/state.js";
import { t } from "../core/i18n.js";
import { el, mount } from "../core/dom.js";
import { escapeHtml, fmtMs, fmtNum } from "../lib/format.js";
import { Empty } from "../components/empty.js";
import { MetricHero, TraceDetailCard } from "../components/metric-hero.js";
import { fetchMetrics, submitScore } from "../data/api.js";
import { enhanceCodeBlocks } from "../lib/code-block.js";
import { createKvTable, appendKvRows, createDataTable, appendDataRow } from "../lib/usage-table-dom.js";

function generationsTable(generations) {
  if (!generations?.length) return Empty(t("emptyNoMetrics"));
  const div = el("div", { className: "panel-bone" });
  div.append(el("h3", {}, [t("tabGenerations")]));
  const table = createDataTable(["id", t("colLatency"), t("colTtft"), t("colTps"), t("colTotal"), t("colCost")]);
  for (const g of generations) {
    const m = g.metrics || {};
    appendDataRow(table, [
      g.id,
      fmtMs(m.latencyMs),
      fmtMs(m.timeToFirstTokenMs),
      fmtNum(m.tokensPerSecond),
      m.totalTokens || 0,
      (m.totalCost || 0) > 0 ? "$" + m.totalCost.toFixed(4) : "—",
    ]);
  }
  div.append(table);
  return div;
}

export async function loadSessionMetrics(key) {
  state.sessionMetrics = null;
  state.metricsByExchangeId = new Map();
  if (!key) return;
  const data = await fetchMetrics(key);
  if (!data) return;
  state.sessionMetrics = data;
  if (!state.sessionMetrics.scores) state.sessionMetrics.scores = [];
  for (const g of data.generations || []) {
    if (g?.id) state.metricsByExchangeId.set(g.id, g.metrics);
  }
}

export function renderOverview(panel) {
  if (!state.selectedSessionKey) {
    mount(panel, Empty(t("emptySelectSession")));
    return;
  }
  if (!state.sessionMetrics?.trace) {
    mount(panel, Empty(t("emptyNoMetrics")));
    loadSessionMetrics(state.selectedSessionKey).then(() => renderOverview(panel));
    return;
  }
  const tr = state.sessionMetrics.trace;
  const blocks = [MetricHero(tr), TraceDetailCard(tr)];
  const gens = state.sessionMetrics.generations;
  if (gens?.length) blocks.push(generationsTable(gens));
  const scores = state.sessionMetrics.scores;
  if (scores?.length) {
    const sdiv = el("div", { className: "panel-bone" });
    sdiv.append(el("h3", {}, ["Scores"]));
    const st = createDataTable([t("scoreName"), t("scoreValue"), "observationId"]);
    for (const s of scores) {
      appendDataRow(st, [s.name, String(s.value), s.observationId || "—"]);
    }
    sdiv.append(st);
    blocks.push(sdiv);
  }
  const form = el("div", { className: "panel-bone" });
  form.innerHTML = "<h3>" + escapeHtml(t("scoreAdd")) + "</h3>";
  const nameIn = el("input", { id: "scoreName", className: "field-input", placeholder: t("scoreName") });
  const valIn = el("input", { id: "scoreVal", className: "field-input", type: "number", step: "0.1", placeholder: t("scoreValue") });
  const btn = el("button", { type: "button", className: "btn", id: "btnScore" }, [t("scoreAdd")]);
  btn.onclick = async () => {
    const n = nameIn.value.trim();
    const v = valIn.value;
    if (n && v !== "") {
      await submitScore(n, v, state.selectedExchangeId);
      await loadSessionMetrics(state.selectedSessionKey);
      renderOverview(panel);
    }
  };
  form.append(el("div", { className: "score-row" }, [nameIn, valIn, btn]));
  blocks.push(form);
  const stack = el("div", { className: "panel-stack" });
  for (const b of blocks) stack.append(b);
  mount(panel, stack);
  enhanceCodeBlocks(panel);
}
