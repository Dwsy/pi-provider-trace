import { t } from "./i18n.js";
import { OVERVIEW_WINDOWS, sortOverviewRows, state } from "./model.js";
import {
  formatBytes,
  formatCost,
  formatCostMeasured,
  formatCount,
  formatDuration,
  formatPercent,
  formatRelative,
  formatTimestamp,
  formatTokensMeasured,
  formatTps,
} from "./format.js";

const elements = {
  windowToggle: document.getElementById("overviewWindow"),
  body: document.getElementById("overviewBody"),
};

/** Logical chart canvas; the SVG scales to its container, so strokes are non-scaling. */
const CHART = { width: 1000, height: 180, padTop: 12, padBottom: 6 };

let chartBuckets = [];
let chartCursor = -1;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = String(text);
  return element;
}

function svgNode(tag, attributes) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes || {})) element.setAttribute(name, String(value));
  return element;
}

/** Same stroke family as every other icon in the app; no glyph stand-ins. */
function sortArrow(direction) {
  const svg = svgNode("svg", { class: "sort-arrow", viewBox: "0 0 12 12", "aria-hidden": "true" });
  svg.append(svgNode("path", {
    d: direction === "asc" ? "M6 9.5v-7M3 5.5 6 2.5l3 3" : "M6 2.5v7M3 6.5l3 3 3-3",
  }));
  return svg;
}

function replace(host, ...children) {
  host.replaceChildren(...children.filter(Boolean));
}

/**
 * `null` means the sample was empty. It renders as an em dash carrying the reason —
 * showing "0 ms" instead would claim a measurement that was never taken.
 */
function measured(value, format) {
  if (value == null) {
    const empty = node("span", "measure-empty", "—");
    empty.title = t("noSampleTitle");
    return empty;
  }
  return node("span", null, format(value));
}

function windowLabel(key) {
  const labels = { "24h": "window24h", "7d": "window7d", "30d": "window30d", all: "windowAll" };
  return t(labels[key] || "window7d");
}

export function updateWindowToggle() {
  elements.windowToggle.querySelectorAll("[data-window]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.window === state.overview.window));
  });
}

function metaLine(data) {
  const meta = node("div", "overview-meta");
  meta.append(
    node("span", null, t("generatedAt", { time: formatTimestamp(data.generatedAt) })),
    node("span", null, t("scannedSummary", {
      sessions: formatCount(data.scanned.sessions),
      included: formatCount(data.scanned.included),
      bytes: formatBytes(data.scanned.bytes),
      duration: formatDuration(data.scanned.durationMs),
    })),
  );
  return meta;
}

function tile({ label, value, detail, detailTitle }) {
  const root = node("div", "overview-tile");
  root.append(node("p", "overview-tile-label", label));
  const strong = node("strong", "overview-tile-value");
  strong.append(value);
  root.append(strong);
  const hint = node("p", "overview-tile-detail", detail);
  if (detailTitle) hint.title = detailTitle;
  root.append(hint);
  return root;
}

function renderTotals(totals) {
  const grid = node("div", "cell-grid overview-tiles");
  const promptTokens = totals.inputTokens + totals.cacheReadTokens;
  const attempts = totals.generations + totals.errors;
  grid.append(
    tile({
      label: t("generations"),
      value: node("span", null, formatCount(totals.generations)),
      detail: t("ofExchanges", { count: formatCount(totals.exchanges) }),
    }),
    tile({
      label: t("totalTokens"),
      value: node("span", null, formatTokensMeasured(totals.totalTokens)),
      detail: `${t("inTokens")} ${formatTokensMeasured(totals.inputTokens)} · ${t("outTokens")} ${formatTokensMeasured(totals.outputTokens)} · ${t("cacheTokens")} ${formatTokensMeasured(totals.cacheReadTokens)}`,
    }),
    tile({
      label: t("cost"),
      value: node("span", null, formatCostMeasured(totals.totalCost)),
      detail: windowLabel(state.overview.window),
      detailTitle: t("windowCostTitle"),
    }),
    tile({
      label: t("cacheHitRate"),
      value: measured(promptTokens > 0 ? totals.cacheHitRate : null, (value) => `${(value * 100).toFixed(1)}%`),
      detail: t("ratioOf", {
        numerator: formatTokensMeasured(totals.cacheReadTokens),
        denominator: formatTokensMeasured(promptTokens),
      }),
    }),
    tile({
      label: t("p95Ttft"),
      value: measured(totals.p95TtftMs, formatDuration),
      detail: `${t("avgAndP50", {
        avg: totals.avgTtftMs == null ? "—" : formatDuration(totals.avgTtftMs),
        p50: totals.p50TtftMs == null ? "—" : formatDuration(totals.p50TtftMs),
      })}`,
      detailTitle: totals.avgTtftMs == null ? t("noSampleTitle") : null,
    }),
    tile({
      label: t("errors"),
      value: node("span", totals.errors ? "is-error" : null, formatCount(totals.errors)),
      detail: `${formatPercent(totals.errors, attempts) ?? "—"} · ${t("errorsOfGenerations", {
        errors: formatCount(totals.errors),
        total: formatCount(attempts),
      })}`,
    }),
  );
  return grid;
}

function chartSummary(buckets) {
  const peak = buckets.reduce((max, bucket) => Math.max(max, bucket.generations), 0);
  const cost = buckets.reduce((total, bucket) => total + bucket.totalCost, 0);
  return t("chartSummary", {
    buckets: formatCount(buckets.length),
    peak: formatCount(peak),
    cost: formatCostMeasured(cost),
  });
}

function bucketTime(value) {
  return state.overview.window === "24h" ? formatTimestamp(value).slice(5, 16) : formatTimestamp(value).slice(0, 10);
}

function setChartCursor(index) {
  const readout = document.getElementById("overviewReadout");
  const marker = document.getElementById("overviewCursor");
  if (!readout || !marker) return;
  const bucket = chartBuckets[index];
  if (!bucket) {
    chartCursor = -1;
    marker.setAttribute("opacity", "0");
    readout.textContent = t("chartHint");
    return;
  }
  if (index === chartCursor) return;
  chartCursor = index;
  const slot = CHART.width / chartBuckets.length;
  marker.setAttribute("x", String(index * slot));
  marker.setAttribute("width", String(slot));
  marker.setAttribute("opacity", "1");
  readout.textContent = t("bucketReadout", {
    time: bucketTime(bucket.bucket),
    generations: formatCount(bucket.generations),
    errors: formatCount(bucket.errors),
    tokens: formatTokensMeasured(bucket.totalTokens),
    cost: formatCostMeasured(bucket.totalCost),
  });
}

function drawChart(buckets) {
  const { width, height, padTop, padBottom } = CHART;
  const plot = height - padTop - padBottom;
  const slot = width / buckets.length;
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.generations));
  const peakCost = Math.max(...buckets.map((bucket) => bucket.totalCost), 0);
  const svg = svgNode("svg", {
    class: "overview-chart",
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "none",
    role: "img",
    tabindex: "0",
    "aria-label": chartSummary(buckets),
  });

  for (const fraction of [0.5, 1]) {
    svg.append(svgNode("line", {
      class: "chart-grid",
      x1: 0,
      x2: width,
      y1: padTop + plot * (1 - fraction),
      y2: padTop + plot * (1 - fraction),
      "vector-effect": "non-scaling-stroke",
    }));
  }

  // A single bucket must read as one bar, not as a slab filling the plot.
  const barWidth = Math.max(1, Math.min(slot * 0.62, width * 0.06));
  for (const [index, bucket] of buckets.entries()) {
    const total = (bucket.generations / peak) * plot;
    const errors = bucket.errors ? Math.max(1.5, (bucket.errors / peak) * plot) : 0;
    const x = index * slot + (slot - barWidth) / 2;
    if (bucket.generations) {
      svg.append(svgNode("rect", {
        class: "chart-bar",
        x,
        y: padTop + plot - total,
        width: barWidth,
        height: Math.max(1.5, total - errors),
      }));
    }
    if (errors) {
      svg.append(svgNode("rect", { class: "chart-bar is-error", x, y: padTop + plot - errors, width: barWidth, height: errors }));
    }
  }

  if (peakCost > 0) {
    const points = buckets
      .map((bucket, index) => `${index * slot + slot / 2},${padTop + plot - (bucket.totalCost / peakCost) * plot}`)
      .join(" ");
    svg.append(svgNode("polyline", { class: "chart-cost", points, "vector-effect": "non-scaling-stroke" }));
  }

  svg.append(svgNode("line", {
    class: "chart-axis",
    x1: 0,
    x2: width,
    y1: padTop + plot,
    y2: padTop + plot,
    "vector-effect": "non-scaling-stroke",
  }));
  svg.append(svgNode("rect", {
    id: "overviewCursor",
    class: "chart-cursor",
    x: 0,
    y: 0,
    width: slot,
    height,
    opacity: 0,
  }));
  return { svg, peak, peakCost };
}

function renderChart(buckets) {
  const section = node("section", "overview-section overview-chart-section");
  const heading = node("div", "section-heading");
  heading.append(node("h2", null, t("timeline")));
  const legend = node("p", "chart-legend");
  legend.append(
    node("span", "legend-key is-bar", t("generations")),
    node("span", "legend-key is-error", t("errors")),
    node("span", "legend-key is-cost", t("cost")),
  );
  heading.append(legend);
  section.append(heading);

  if (!buckets.length) {
    section.append(node("p", "overview-note", t("overviewEmptyHint")));
    return section;
  }

  chartBuckets = buckets;
  chartCursor = -1;
  const readout = node("p", "chart-readout", t("chartHint"));
  readout.id = "overviewReadout";
  readout.setAttribute("aria-live", "polite");
  const { svg, peak, peakCost } = drawChart(buckets);

  svg.addEventListener("pointermove", (event) => {
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width) return;
    setChartCursor(Math.min(buckets.length - 1, Math.floor(((event.clientX - bounds.left) / bounds.width) * buckets.length)));
  });
  svg.addEventListener("pointerleave", () => setChartCursor(-1));
  svg.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -buckets.length, End: buckets.length }[event.key];
    if (step == null) return;
    event.preventDefault();
    const base = chartCursor < 0 ? buckets.length - 1 : chartCursor;
    setChartCursor(Math.min(buckets.length - 1, Math.max(0, base + step)));
  });

  const frame = node("div", "chart-frame");
  const scale = node("div", "chart-scale");
  scale.append(
    node("span", null, formatCount(peak)),
    node("span", "chart-scale-cost", peakCost > 0 ? formatCost(peakCost) : ""),
  );
  frame.append(scale, svg);

  const axis = node("div", "chart-axis-labels");
  // Start / middle / end collapse to fewer labels when the window holds few buckets.
  const ticks = [...new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1])]
    .map((index) => bucketTime(buckets[index].bucket));
  for (const tick of [...new Set(ticks)]) axis.append(node("span", null, tick));

  section.append(readout, frame, axis);
  return section;
}

function headerCell(column, scope) {
  const th = node("th", column.numeric ? "is-numeric" : null);
  th.setAttribute("role", "columnheader");
  th.scope = "col";
  if (!column.key) {
    th.append(node("span", null, column.label));
    return th;
  }
  const sort = state.overview.sort[scope];
  const active = sort.key === column.key;
  th.setAttribute("aria-sort", active ? (sort.direction === "asc" ? "ascending" : "descending") : "none");
  const button = node("button", "sort-button", column.label);
  button.type = "button";
  button.dataset.sort = `${scope}:${column.key}`;
  button.setAttribute("aria-label", t("sortBy", { column: column.label }));
  if (active) button.append(sortArrow(sort.direction));
  th.append(button);
  return th;
}

function bodyCell(column, content, title) {
  const td = node("td", column.numeric ? "is-numeric" : null);
  td.setAttribute("role", "cell");
  td.dataset.column = column.label;
  if (title) td.title = title;
  td.append(typeof content === "string" ? node("span", null, content) : content);
  return td;
}

/** One table shape for models, providers, and sessions; cells come from `cellsFor`. */
function dataTable({ scope, columns, rows, cellsFor, rowAttributes }) {
  const table = node("table", "overview-table");
  table.setAttribute("role", "table");
  // Explicit roles survive the display:block card layout used under 700px.
  const head = document.createElement("thead");
  head.setAttribute("role", "rowgroup");
  const headRow = document.createElement("tr");
  headRow.setAttribute("role", "row");
  for (const column of columns) headRow.append(headerCell(column, scope));
  head.append(headRow);
  const body = document.createElement("tbody");
  body.setAttribute("role", "rowgroup");
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.setAttribute("role", "row");
    Object.assign(tr.dataset, rowAttributes?.(row) || {});
    const cells = cellsFor(row);
    for (const [index, cell] of cells.entries()) tr.append(bodyCell(columns[index], cell.content, cell.title));
    body.append(tr);
  }
  table.append(head, body);
  return table;
}

function errorRateOf(row) {
  const attempts = row.generations + row.errors;
  return attempts > 0 ? row.errors / attempts : 0;
}

function errorCell(row) {
  const attempts = row.generations + row.errors;
  return {
    content: formatPercent(row.errors, attempts) ?? "—",
    title: t("errorsOfGenerations", { errors: formatCount(row.errors), total: formatCount(attempts) }),
  };
}

function sortedFor(scope, rows) {
  const sort = state.overview.sort[scope];
  return sortOverviewRows(rows, sort.key, sort.direction);
}

function renderModels(models) {
  const columns = [
    { key: "key", label: t("model") },
    { key: "generations", label: t("generations"), numeric: true },
    { key: "totalTokens", label: t("tokens"), numeric: true },
    { key: "totalCost", label: t("cost"), numeric: true },
    { key: "avgTtftMs", label: t("avgTtft"), numeric: true },
    { key: "p95TtftMs", label: t("p95Ttft"), numeric: true },
    { key: "avgOutputTps", label: t("outputRate"), numeric: true },
    { key: "errorRate", label: t("errorRate"), numeric: true },
    { key: "sessions", label: t("sessionReach"), numeric: true },
  ];
  const rows = sortedFor("models", models.map((model) => ({ ...model, errorRate: errorRateOf(model) })));
  const section = node("section", "overview-section");
  section.append(sectionHeading(t("model"), formatCount(models.length)));
  section.append(dataTable({
    scope: "models",
    columns,
    rows,
    cellsFor: (row) => {
      const identity = node("div", "table-identity");
      identity.append(node("span", "table-name", row.model), node("span", "provider-tag", row.provider));
      return [
        { content: identity },
        { content: formatCount(row.generations) },
        {
          content: formatTokensMeasured(row.totalTokens),
          title: `${t("inTokens")} ${formatCount(row.inputTokens)} · ${t("outTokens")} ${formatCount(row.outputTokens)} · ${t("cacheTokens")} ${formatCount(row.cacheReadTokens)}`,
        },
        { content: formatCostMeasured(row.totalCost) },
        { content: measured(row.avgTtftMs, formatDuration) },
        { content: measured(row.p95TtftMs, formatDuration) },
        { content: measured(row.avgOutputTps, formatTps) },
        errorCell(row),
        { content: formatCount(row.sessions) },
      ];
    },
  }));
  return section;
}

function renderProviders(providers) {
  const columns = [
    { key: "provider", label: t("provider") },
    { key: "generations", label: t("generations"), numeric: true },
    { key: "totalTokens", label: t("tokens"), numeric: true },
    { key: "totalCost", label: t("cost"), numeric: true },
    { key: "avgTtftMs", label: t("avgTtft"), numeric: true },
    { key: "errorRate", label: t("errorRate"), numeric: true },
    { key: "sessions", label: t("sessionReach"), numeric: true },
    { key: "models", label: t("modelsCount"), numeric: true },
  ];
  const rows = sortedFor("providers", providers.map((provider) => ({ ...provider, errorRate: errorRateOf(provider) })));
  const section = node("section", "overview-section");
  section.append(sectionHeading(t("providers"), formatCount(providers.length)));
  section.append(dataTable({
    scope: "providers",
    columns,
    rows,
    cellsFor: (row) => [
      { content: node("span", "table-name", row.provider) },
      { content: formatCount(row.generations) },
      { content: formatTokensMeasured(row.totalTokens) },
      { content: formatCostMeasured(row.totalCost) },
      { content: measured(row.avgTtftMs, formatDuration) },
      errorCell(row),
      { content: formatCount(row.sessions) },
      { content: formatCount(row.models) },
    ],
  }));
  return section;
}

function renderSessions(sessions) {
  const columns = [
    { key: "label", label: t("sessions") },
    { key: "lastTs", label: t("lastActivity"), numeric: true },
    { key: "generations", label: t("generations"), numeric: true },
    { key: "errors", label: t("errors"), numeric: true },
    { key: "totalTokens", label: t("tokens"), numeric: true },
    { key: "totalCost", label: t("cost"), numeric: true },
    { key: "avgTtftMs", label: t("avgTtft"), numeric: true },
    { label: t("model") },
  ];
  const rows = sortedFor("sessions", sessions);
  const section = node("section", "overview-section");
  section.append(sectionHeading(t("sessions"), formatCount(sessions.length)));
  section.append(dataTable({
    scope: "sessions",
    columns,
    rows,
    rowAttributes: (row) => ({ sessionKey: row.key }),
    cellsFor: (row) => {
      const open = node("button", "table-link", row.label || row.key);
      open.type = "button";
      open.dataset.overviewSession = row.key;
      open.setAttribute("aria-label", t("openSession", { name: row.label || row.key }));
      const identity = node("div", "table-identity");
      identity.append(open, node("span", "table-sub", row.key));
      const models = node("div", "model-chips");
      for (const key of row.models) models.append(node("span", "provider-tag", key.split("/")[1] || key));
      return [
        { content: identity },
        { content: formatRelative(row.lastTs), title: formatTimestamp(row.lastTs) },
        { content: formatCount(row.generations) },
        { content: node("span", row.errors ? "is-error" : null, formatCount(row.errors)) },
        { content: formatTokensMeasured(row.totalTokens) },
        { content: formatCostMeasured(row.totalCost) },
        { content: measured(row.avgTtftMs, formatDuration) },
        { content: models },
      ];
    },
  }));
  return section;
}

function sectionHeading(title, meta) {
  const heading = node("div", "section-heading");
  heading.append(node("h2", null, title));
  if (meta) heading.append(node("p", "section-meta", meta));
  return heading;
}

function skeleton() {
  const root = node("div", "overview-skeleton");
  for (let index = 0; index < 8; index += 1) root.append(node("div", "skeleton-line"));
  return root;
}

function stateBlock(title, hint, { error = false, action } = {}) {
  const root = node("div", error ? "error-state" : "empty-state");
  root.append(node("h2", null, title), node("p", null, hint));
  if (action) {
    const button = node("button", "text-button", action.label);
    button.type = "button";
    button.dataset.action = action.name;
    root.append(button);
  }
  return root;
}

export function renderOverview() {
  updateWindowToggle();
  const { loading, error, data, fixture } = state.overview;
  if (loading && !data) {
    replace(elements.body, skeleton());
    return;
  }
  if (error && !data) {
    replace(elements.body, stateBlock(t("overviewFailed"), `${t("overviewFailedHint")} (${error})`, {
      error: true,
      action: { name: "overview-retry", label: t("retry") },
    }));
    return;
  }
  if (!data) return;

  const parts = [];
  if (fixture) parts.push(node("div", "notice", t("fixtureNotice")));
  if (data.scanned.truncated) parts.push(node("div", "notice", t("truncatedNotice")));
  if (!data.totals.exchanges) {
    parts.push(stateBlock(t("overviewEmpty"), t("overviewEmptyHint")), metaLine(data));
    replace(elements.body, ...parts);
    return;
  }
  // Provenance is a caption under the numbers it describes, not a banner above them.
  parts.push(
    renderTotals(data.totals),
    renderChart(data.timeline),
    renderModels(data.models),
    renderProviders(data.providers),
    renderSessions(data.sessions),
    metaLine(data),
  );
  replace(elements.body, ...parts);
  elements.body.scrollTop = 0;
}

export function overviewWindowFromToken(token) {
  return OVERVIEW_WINDOWS.includes(token) ? token : null;
}
