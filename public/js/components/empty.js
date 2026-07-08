import { el } from "../core/dom.js";

export function Empty(message) {
  return el("div", { className: "empty" }, [message]);
}
