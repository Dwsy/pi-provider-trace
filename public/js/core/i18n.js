import { state } from "./state.js";

let I18N = { zh: {}, en: {} };

export async function loadI18n() {
  const r = await fetch("/api/i18n");
  I18N = await r.json();
}

export function t(key, vars) {
  const dict = I18N[state.locale] || I18N.en;
  let s = dict[key] || I18N.en[key] || key;
  if (vars) for (const k in vars) s = s.split("{" + k + "}").join(String(vars[k]));
  return s;
}

export function applyThemeSelectLabels() {
  const sel = document.getElementById("theme");
  if (!sel || sel.options.length < 3) return;
  sel.options[0].textContent = t("themeSystem");
  sel.options[1].textContent = t("themeLight");
  sel.options[2].textContent = t("themeDark");
}

export function applyI18nStatic() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
  const lang = document.getElementById("lang");
  if (lang) lang.value = state.locale;
  applyThemeSelectLabels();
}
