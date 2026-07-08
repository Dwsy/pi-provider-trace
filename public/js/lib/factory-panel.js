/** Factory layout: bone card on obsidian canvas */
export const PANEL_BONE = "panel-bone";
export const PANEL_DARK = "panel-dark";

export function panelBone(title) {
  const wrap = document.createElement("div");
  wrap.className = PANEL_BONE;
  if (title) {
    const h = document.createElement("h3");
    h.textContent = title;
    wrap.append(h);
  }
  return wrap;
}
