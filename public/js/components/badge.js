import { el } from "../core/dom.js";

export function Badge(text, variant) {
  const cls = "badge" + (variant ? " " + variant : "");
  return el("span", { className: cls }, [text]);
}
