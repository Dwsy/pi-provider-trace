import { state } from "../core/state.js";
import { t } from "../core/i18n.js";
import { el, mount } from "../core/dom.js";
import { escapeHtml, prettyJson } from "../lib/format.js";
import { exchanges } from "../data/store.js";
import { Empty } from "../components/empty.js";
import { UsageTable } from "../components/usage-table.js";
import { sumUsage } from "../lib/usage.js";
import { assembleStreamText } from "../lib/sse.js";
import { SseEventList } from "../components/sse-event-list.js";
import { renderOverview } from "./overview.js";
import { renderTimeline } from "./timeline.js";
import { renderRequestBodyUi } from "./request-body-view.js";
import { enhanceCodeBlocks } from "../lib/code-block.js";

function mountPanel(panel, child) {
  mount(panel, child);
  enhanceCodeBlocks(panel);
}

export function renderPanel(panel, onListRefresh) {
  if (state.activeTab === "overview") {
    renderOverview(panel);
    enhanceCodeBlocks(panel);
    return;
  }
  if (state.activeTab === "timeline") {
    renderTimeline(panel, onListRefresh);
    enhanceCodeBlocks(panel);
    return;
  }
  if (state.activeTab === "usage") {
    const sessionTotal = sumUsage([...exchanges.values()].map((e) => e.usage).filter(Boolean));
    const stack = el("div", { className: "panel-stack" });
    stack.append(UsageTable(sessionTotal, t("usageSession")));
    const ex = state.selectedExchangeId ? exchanges.get(state.selectedExchangeId) : null;
    if (ex?.usage) stack.append(UsageTable(ex.usage, t("usageExchange")));
    else if (!state.selectedExchangeId) stack.append(Empty(t("emptySelectExchange")));
    mountPanel(panel, stack);
    return;
  }
  const ex = state.selectedExchangeId ? exchanges.get(state.selectedExchangeId) : null;
  if (!ex) {
    mountPanel(panel, Empty(t("emptySelectExchange")));
    return;
  }
  const usageBlock = ex.usage ? UsageTable(ex.usage, t("usageExchange")) : null;
  if (state.activeTab === "req-headers") {
    if (!ex.request) {
      mountPanel(panel, Empty(t("emptyNoRequest")));
      return;
    }
    const stack = el("div", { className: "panel-stack" });
    stack.append(
      el("p", { className: "stat" }, [
        escapeHtml(ex.request.method || "?"),
        " ",
        el("strong", {}, [escapeHtml(ex.request.url || t("noUrl"))]),
      ]),
    );
    const grid = el("div", { className: "headers-grid" });
    if (ex.request.headers) {
      for (const [k, v] of Object.entries(ex.request.headers)) {
        const row = el("div");
        row.innerHTML = "<span>" + escapeHtml(k) + "</span><span>" + escapeHtml(String(v)) + "</span>";
        grid.append(row);
      }
    } else {
      grid.append(el("p", { className: "empty" }, [t("noHeaders")]));
    }
    const card = el("div", { className: "panel-dark" });
    card.append(el("h3", {}, [t("tabReqHeaders")]));
    card.append(grid);
    stack.append(card);
    mountPanel(panel, stack);
    return;
  }
  if (state.activeTab === "request-body") {
    const stack = el("div", { className: "panel-stack" });
    stack.append(renderRequestBodyUi(ex.request?.bodyPreview));
    const mediaBox = el("div", { id: "mediaBox" });
    stack.append(mediaBox);
    mountPanel(panel, stack);
    if (state.selectedSessionKey && ex.id) {
      fetch("/api/media?session=" + encodeURIComponent(state.selectedSessionKey) + "&exchange=" + encodeURIComponent(ex.id))
        .then((r) => r.json())
        .then((media) => {
          if (!media.length) return;
          const box = document.getElementById("mediaBox");
          if (!box) return;
          const h = el("div", { className: "panel-dark" });
          h.append(el("h3", {}, ["Media"]));
          for (const m of media) {
            if (m.url) {
              const img = el("img", { src: m.url, alt: "", className: "media-preview", referrerPolicy: "no-referrer" });
              h.append(el("p", {}, [img]));
            } else h.append(el("p", {}, [(m.mimeType || m.type) + " " + (m.previewRef || "")]));
          }
          box.append(h);
        })
        .catch(() => {});
    }
    return;
  }
  if (state.activeTab === "response") {
    if (!ex.response) {
      mountPanel(panel, Empty(t("emptyNoResponse")));
      return;
    }
    const grid = el("div", { className: "headers-grid" });
    if (ex.response.headers) {
      for (const [k, v] of Object.entries(ex.response.headers)) {
        const row = el("div");
        row.innerHTML = "<span>" + escapeHtml(k) + "</span><span>" + escapeHtml(String(v)) + "</span>";
        grid.append(row);
      }
    }
    mountPanel(panel, el("div", {}, [
      el("p", {}, ["HTTP ", el("strong", {}, [String(ex.response.status ?? "?")])]),
      grid,
    ]));
    return;
  }
  if (state.activeTab === "raw") {
    mountPanel(panel, el("pre", { className: "json" }, [ex.sse.map((s) => s.line).join("\n") || "—"]));
    return;
  }
  const assembled = assembleStreamText(ex.sse);
  const stack = el("div", { className: "panel-stack" });
  if (usageBlock) stack.append(usageBlock);
  const hero = el("div", { className: "panel-bone stream-panel" });
  hero.append(el("h3", {}, [t("assembledTitle")]));
  hero.append(el("div", { className: "assembled" }, [assembled || "—"]));
  stack.append(hero);
  stack.append(el("p", { className: "stat" }, [t("linesChars", { lines: ex.sse.length, chars: assembled.length })]));
  if (ex.sse.length) {
    stack.append(SseEventList(ex.sse));
  } else stack.append(Empty(t("emptyNoSse")));
  mountPanel(panel, stack);
}