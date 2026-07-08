import { el } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { createKvTable, appendKvRows } from "../lib/usage-table-dom.js";

export function UsageTable(metrics, title) {
  const m = metrics || {};
  const pct = ((m.cacheHitRate || 0) * 100).toFixed(1);
  const cost = (m.costTotal || 0) > 0 ? "$" + m.costTotal.toFixed(4) : "—";
  const wrap = el("div", { className: "panel-bone" });
  wrap.append(el("h3", {}, [title]));
  const table = createKvTable();
  appendKvRows(table, [
    [t("colInput"), m.input || 0, t("colOutput"), m.output || 0],
    [t("colCacheRead"), m.cacheRead || 0, t("colCacheWrite"), m.cacheWrite || 0],
    [t("colCacheRate"), pct + "%", t("colCost"), cost],
    [t("colTotal"), String(m.totalTokens || 0), "", ""],
  ]);
  wrap.append(table);
  return wrap;
}