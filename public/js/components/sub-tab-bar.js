/** Nested tab bar (same .tabs / .tab classes as main stage). */
export function bindSubTabs(root) {
  const bar = root.querySelector(".req-subtabs");
  if (!bar) return;
  const panels = root.querySelectorAll(".req-subpanel");
  const activate = (id) => {
    if (!id) return;
    bar.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.reqTab === id));
    panels.forEach((p) => p.classList.toggle("active", p.dataset.reqTab === id));
  };
  bar.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activate(tab.dataset.reqTab));
  });
  const active = bar.querySelector(".tab.active") || bar.querySelector(".tab");
  if (active) activate(active.dataset.reqTab);
}

export function createSubTabBar(tabs) {
  const bar = document.createElement("div");
  bar.className = "tabs req-subtabs";
  for (const { id, label, active } of tabs) {
    const tab = document.createElement("div");
    tab.className = "tab" + (active ? " active" : "");
    tab.dataset.reqTab = id;
    tab.textContent = label;
    bar.append(tab);
  }
  return bar;
}

export function createSubPanel(id, contentEl, active) {
  const panel = document.createElement("div");
  panel.className = "req-subpanel" + (active ? " active" : "");
  panel.dataset.reqTab = id;
  panel.append(contentEl);
  return panel;
}