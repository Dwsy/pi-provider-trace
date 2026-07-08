import { state } from "../core/state.js";
import { t } from "../core/i18n.js";
import { el, mount, clear } from "../core/dom.js";
import { fmtMs } from "../lib/format.js";
import { exchangePathLabel, exchangeRowTitle } from "../lib/exchange-label.js";
import { exchanges } from "../data/store.js";
import { providerChip } from "../lib/provider.js";
import { Badge } from "../components/badge.js";
import { Empty } from "../components/empty.js";

function matchesSearch(ex) {
  if (!state.searchQ) return true;
  const q = state.searchQ.toLowerCase();
  return [ex.id, ex.request?.url, ex.request?.method].filter(Boolean).join(" ").toLowerCase().includes(q);
}

function sortedExchanges() {
  return [...exchanges.values()]
    .filter((ex) => ex.request)
    .filter(matchesSearch)
    .sort((a, b) => (b.lastTs || "").localeCompare(a.lastTs || ""));
}

export function renderExchangeList(container, onSelect) {
  const list = sortedExchanges();
  clear(container);
  if (!list.length) {
    container.append(Empty(t("emptyNoExchanges")));
    return;
  }
  for (const ex of list) {
    const div = el("div", { className: "ex" + (ex.id === state.selectedExchangeId ? " active" : "") });
    const u = ex.usage || {};
    const method = ex.request?.method || "—";
    const url = ex.request?.url;
    const row = el("div", { className: "ex-title-row" });
    const methodEl = el("span", { className: "ex-method" }, [method]);
    row.append(methodEl);
    row.append(providerChip(u.provider, u.model, url));
    const title = el("div", { className: "ex-title", title: url || "" });
    title.textContent = exchangePathLabel(url, 80) || t("noUrl");
    row.append(title);
    div.append(row);
    div.title = exchangeRowTitle(method, url, t("noUrl"));
    const meta = el("div", { className: "ex-meta" });
    meta.append(Badge(ex.id));
    const st = ex.response?.status;
    if (st != null) meta.append(Badge(String(st), st < 400 ? "ok" : "err"));
    if (ex.sse.length) meta.append(Badge(String(ex.sse.length), "sse"));
    if (ex.usage?.costTotal > 0) meta.append(Badge("$" + ex.usage.costTotal.toFixed(3)));
    if (ex.usage?.cacheHitRate > 0) meta.append(Badge(((ex.usage.cacheHitRate * 100) | 0) + "%"));
    const m = state.metricsByExchangeId.get(ex.id);
    if (m) {
      meta.append(Badge(fmtMs(m.timeToFirstTokenMs) + " TTFT"));
      meta.append(Badge(fmtMs(m.latencyMs)));
    }
    div.append(meta);
    div.onclick = () => {
      state.selectedExchangeId = ex.id;
      onSelect();
    };
    container.append(div);
  }
}
