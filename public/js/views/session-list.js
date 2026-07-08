import { state } from "../core/state.js";
import { t } from "../core/i18n.js";
import { el, clear } from "../core/dom.js";
import { escapeHtml } from "../lib/format.js";
import { fetchSessions, downloadTrace, deleteTrace } from "../data/api.js";
import { Empty } from "../components/empty.js";
import { clearStore } from "../data/store.js";

export function renderSessionList(container, selectSession, onStoreCleared) {
  fetchSessions()
    .then(async (data) => {
      const sessions = data.sessions || [];
      const pick = state.selectedSessionKey || data.activeSessionKey || (sessions[0] && sessions[0].key);
      if (pick && pick !== state.selectedSessionKey) await selectSession(pick, false);
      clear(container);
      if (!sessions.length) {
        container.append(Empty(t("emptyNoSessions")));
        return;
      }
      for (const s of sessions) {
        const div = el("div", { className: "sess" + (s.key === state.selectedSessionKey ? " active" : "") });
        const main = el("div", { className: "sess-main" });
        main.append(el("div", { className: "sess-title" }, [s.label || s.key]));
        const size = s.httpLogBytes != null ? t("bytes", { n: s.httpLogBytes }) : "";
        main.append(el("div", { className: "sess-meta" }, [
          s.key + " · " + t("records", { n: s.records || 0 }) + (size ? " · " + size : ""),
        ]));
        main.onclick = () => selectSession(s.key);
        const actions = el("div", { className: "sess-actions" });
        const dl = el("button", { type: "button", className: "btn dl" }, [t("downloadTrace")]);
        dl.onclick = (e) => { e.stopPropagation(); downloadTrace(s.key, "http-sse"); };
        actions.append(dl);
        if (s.hasPayloadLog) {
          const dp = el("button", { type: "button", className: "btn dl-p" }, ["payload"]);
          dp.onclick = (e) => { e.stopPropagation(); downloadTrace(s.key, "provider-payload"); };
          actions.append(dp);
        }
        const del = el("button", { type: "button", className: "btn danger del" }, [t("deleteTrace")]);
        del.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm(t("deleteConfirm"))) return;
          await deleteTrace(s.key);
          if (state.selectedSessionKey === s.key) {
            state.selectedSessionKey = null;
            state.selectedExchangeId = null;
            clearStore();
            if (onStoreCleared) onStoreCleared();
          }
          renderSessionList(container, selectSession, onStoreCleared);
        };
        actions.append(del);
        div.append(main, actions);
        container.append(div);
      }
    })
    .catch(() => {
      clear(container);
      container.append(Empty(t("apiError")));
    });
}
