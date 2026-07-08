import { state, SESSION_HOOK_NAMES } from "../core/state.js";
import { t } from "../core/i18n.js";
import { el, mount } from "../core/dom.js";
import { escapeHtml, shortUrl } from "../lib/format.js";
import { timelineEntries } from "../data/store.js";
import { providerChip } from "../lib/provider.js";
import { Empty } from "../components/empty.js";
import { setActiveTab } from "../components/tab-bar.js";
import { exchanges } from "../data/store.js";
import { buildTimelineList } from "../lib/timeline-merge.js";
import { enhanceCodeBlocks } from "../lib/code-block.js";

function timelineLane(rec) {
  if (rec.kind === "sse_merged") return "sse";
  if (rec.kind === "pi_event" || rec.kind === "llm_usage") return "pi";
  if (rec.kind === "sse_line") return "sse";
  return "http";
}

function isSessionHook(rec) {
  return rec.kind === "pi_event" && SESSION_HOOK_NAMES.has(rec.eventName || "");
}

function timelineVisible(rec) {
  const lane = timelineLane(rec);
  if (lane === "pi" && isSessionHook(rec)) return state.filterSessionHooks;
  if (lane === "pi") return state.filterPi;
  if (lane === "sse") return state.showSseInTimeline;
  return state.filterHttp;
}

function timelineLabelText(rec) {
  if (rec.kind === "sse_merged") {
    return t("timelineSseMerged", { lines: rec.lineCount || 0, chars: (rec.text || "").length });
  }
  if (rec.kind === "llm_usage") return rec.summary || "usage";
  if (rec.kind === "pi_event") {
    if (rec.eventName === "message_end" || rec.eventName === "turn_end") {
      const u = rec.detail?.usage;
      if (u?.input != null) return rec.summary + " · in " + u.input + " out " + u.output;
    }
    return rec.summary || rec.eventName || "pi";
  }
  if (rec.kind === "request") return "HTTP " + (rec.method || "?") + " " + shortUrl(rec.url, t("noUrl"));
  if (rec.kind === "response_meta") return "HTTP " + (rec.status ?? "?");
  if (rec.kind === "sse_line") return "SSE " + (rec.line || "").slice(0, 80);
  if (rec.kind === "error") return "ERR " + (rec.message || "");
  return rec.kind;
}

function timelineBody(rec) {
  if (rec.kind === "sse_merged") {
    const pre = el("div", { className: "tl-sse-merged" }, [rec.text || rec.summary || "—"]);
    return pre;
  }
  if (rec.kind === "llm_usage") {
    const u = rec.usage || {};
    const wrap = el("span");
    wrap.append(providerChip(u.provider, u.model, ""));
    wrap.append(el("span", { className: "tl-body dim" }, [rec.summary || ""]));
    return wrap;
  }
  return el("span", {}, [timelineLabelText(rec)]);
}

function bindToolbar(panel, rerender) {
  const pi = panel.querySelector("#tlPi");
  const sess = panel.querySelector("#tlSess");
  const http = panel.querySelector("#tlHttp");
  const sse = panel.querySelector("#tlSse");
  const merge = panel.querySelector("#tlMergeSse");
  if (pi) pi.onchange = () => { state.filterPi = pi.checked; rerender(); };
  if (sess) sess.onchange = () => { state.filterSessionHooks = sess.checked; rerender(); };
  if (http) http.onchange = () => { state.filterHttp = http.checked; rerender(); };
  if (sse) sse.onchange = () => { state.showSseInTimeline = sse.checked; rerender(); };
  if (merge) merge.onchange = () => { state.mergeSseDeltaInTimeline = merge.checked; rerender(); };
}

export function renderTimeline(panel, onSelectExchange) {
  const items = buildTimelineList(timelineEntries, {
    filterVisible: timelineVisible,
    mergeSseDelta: state.mergeSseDeltaInTimeline,
    showSse: state.showSseInTimeline,
  });

  const toolbar = el("div", { className: "tl-toolbar" });
  toolbar.innerHTML =
    '<label><input type="checkbox" class="trace-ui-check" id="tlPi" ' + (state.filterPi ? "checked" : "") + " /> " + t("timelinePi") + "</label>" +
    '<label><input type="checkbox" class="trace-ui-check" id="tlSess" ' + (state.filterSessionHooks ? "checked" : "") + " /> " + t("timelineSession") + "</label>" +
    '<label><input type="checkbox" class="trace-ui-check" id="tlHttp" ' + (state.filterHttp ? "checked" : "") + " /> " + t("timelineHttp") + "</label>" +
    '<label><input type="checkbox" class="trace-ui-check" id="tlSse" ' + (state.showSseInTimeline ? "checked" : "") + " /> " + t("showSseInTimeline") + "</label>" +
    '<label><input type="checkbox" class="trace-ui-check" id="tlMergeSse" ' + (state.mergeSseDeltaInTimeline ? "checked" : "") + " /> " + t("mergeSseDelta") + "</label>";

  const root = el("div");
  root.append(toolbar);
  if (!items.length) {
    root.append(Empty(t("emptyTimeline")));
    mount(panel, root);
    enhanceCodeBlocks(panel);
    bindToolbar(panel, () => renderTimeline(panel, onSelectExchange));
    return;
  }

  const tl = el("div", { className: "timeline" });
  for (const rec of items) {
    const lane = timelineLane(rec);
    const time = (rec.ts || "").replace("T", " ").slice(0, 19);
    let laneTag = t("timelineHttp");
    if (rec.kind === "sse_merged") laneTag = t("timelineSseMergedLabel");
    else if (isSessionHook(rec)) laneTag = t("timelineSession");
    else if (lane === "pi") laneTag = t("timelinePi");
    else if (lane === "sse") laneTag = "SSE";

    const item = el("div", {
      className: "tl-item " + lane + (isSessionHook(rec) ? " session-hook" : "") + (rec.kind === "sse_merged" ? " sse-merged" : ""),
      dataset: { ex: rec.id },
    });
    const laneClass = lane === "pi" ? "pi" : lane === "sse" ? "sse" : "http";
    const dot = el("div", { className: "tl-dot " + laneClass + (isSessionHook(rec) ? " session-hook" : "") });
    const content = el("div", { className: "tl-content" });
    content.append(el("div", { className: "tl-time" }, [time + " ", el("span", { className: "tl-lane " + laneClass }, [laneTag])]));
    const body = el("div", { className: "tl-body" + (lane === "sse" && rec.kind !== "sse_merged" ? " dim" : "") });
    body.append(timelineBody(rec));
    content.append(body);
    item.append(dot, content);

    if (lane === "http" || rec.kind === "sse_merged") {
      item.style.cursor = "pointer";
      item.onclick = () => {
        const id = rec.id;
        if (id && exchanges.has(id)) {
          state.selectedExchangeId = id;
          setActiveTab("stream");
          onSelectExchange();
        }
      };
    }
    tl.append(item);
  }
  root.append(tl);
  mount(panel, root);
  enhanceCodeBlocks(panel);
  bindToolbar(panel, () => renderTimeline(panel, onSelectExchange));
}