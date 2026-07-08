import { escapeHtml } from "./format.js";

/** Key–value rows: th label | td value | th label | td value */
export function appendKvRows(table, rows) {
  const tbody = table.tBodies[0] || table.appendChild(document.createElement("tbody"));
  for (const row of rows) {
    const tr = document.createElement("tr");
    const [l1, v1, l2, v2] = row;
    tr.innerHTML =
      "<th scope=\"row\">" + escapeHtml(String(l1)) + "</th><td>" + escapeHtml(String(v1 ?? "")) + "</td>" +
      (l2 != null && l2 !== ""
        ? "<th scope=\"row\">" + escapeHtml(String(l2)) + "</th><td>" + escapeHtml(String(v2 ?? "")) + "</td>"
        : "<td colspan=\"2\"></td>");
    tbody.append(tr);
  }
}

export function createKvTable(className = "usage-table usage-kv") {
  const table = document.createElement("table");
  table.className = className;
  table.innerHTML =
    "<colgroup><col class=\"col-label\" /><col class=\"col-value\" /><col class=\"col-label\" /><col class=\"col-value\" /></colgroup><tbody></tbody>";
  return table;
}

/** Columnar data table with header row */
export function createDataTable(columns, className = "usage-table usage-grid gen-table") {
  const table = document.createElement("table");
  table.className = className;
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const col of columns) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = col;
    hr.append(th);
  }
  thead.append(hr);
  table.append(thead, document.createElement("tbody"));
  return table;
}

export function appendDataRow(table, cells) {
  const tbody = table.tBodies[0];
  const tr = document.createElement("tr");
  for (const c of cells) {
    const td = document.createElement("td");
    td.textContent = c == null ? "" : String(c);
    tr.append(td);
  }
  tbody.append(tr);
}