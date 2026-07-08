/** App-wide mutable state (single source). */
export const state = {
  locale: localStorage.getItem("pi-trace-locale") || (navigator.language.startsWith("zh") ? "zh" : "en"),
  selectedSessionKey: null,
  selectedExchangeId: null,
  activeTab: "overview",
  sessionMetrics: null,
  metricsByExchangeId: new Map(),
  paused: false,
  autoSelect: true,
  searchQ: "",
  showSseInTimeline: true,
  mergeSseDeltaInTimeline: true,
  filterPi: true,
  filterSessionHooks: true,
  filterHttp: true,
  es: null,
  };

export const SESSION_HOOK_NAMES = new Set([
  "session_before_switch","session_switch","session_before_fork","session_fork",
  "session_before_compact","session_compact","session_before_tree","session_tree",
  "session_info_changed","session_start","session_shutdown",
]);
