import { state } from "../core/state.js";

const TABS = [
  { id: "stream", i18n: "tabStream" },
  { id: "req-headers", i18n: "tabReqHeaders" },
  { id: "request-body", i18n: "tabRequestBody" },
  { id: "response", i18n: "tabResponse" },
  { id: "raw", i18n: "tabRaw" },
  { id: "overview", i18n: "tabOverview" },
  { id: "usage", i18n: "tabUsage" },
  { id: "timeline", i18n: "tabTimeline" },
];

export function bindTabBar(container, onChange) {
  container.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      container.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      tab.classList.add("active");
      state.activeTab = tab.dataset.tab;
      onChange(state.activeTab);
    });
  });
}

export function setActiveTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll(".tab").forEach((x) => {
    x.classList.toggle("active", x.dataset.tab === tabId);
  });
}

export { TABS };
