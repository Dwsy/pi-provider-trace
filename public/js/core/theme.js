
const STORAGE_KEY = "pi-trace-theme";

export function resolveTheme(preference) {
  if (preference === "light" || preference === "dark") return preference;
  if (typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

export function getThemePreference() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

export function applyTheme(preference) {
  const theme = preference === "system" ? resolveTheme("system") : preference;
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  return theme;
}

export function setThemePreference(preference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {}
  return applyTheme(preference);
}

export function initThemeEarly() {
  applyTheme(getThemePreference());
}

export function watchSystemTheme(onChange) {
  if (typeof matchMedia === "undefined") return () => {};
  const mq = matchMedia("(prefers-color-scheme: light)");
  const handler = () => {
    if (getThemePreference() !== "system") return;
    applyTheme("system");
    if (onChange) onChange();
  };
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
