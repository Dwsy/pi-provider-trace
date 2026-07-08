/** Default UI locale: saved preference, else China/zh signals → zh, else en. */

const CHINA_TZ = /^Asia\/(Shanghai|Urumqi|Chongqing|Harbin|Kashgar)$/i;

export function isChinaOrZhLocale() {
  try {
    const langs = navigator.languages?.length ? [...navigator.languages] : [navigator.language];
    if (langs.some((l) => /^zh(-|$)/i.test(String(l || "")))) return true;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (CHINA_TZ.test(tz)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function detectDefaultLocale() {
  const stored = localStorage.getItem("pi-trace-locale");
  if (stored === "zh" || stored === "en") return stored;
  return isChinaOrZhLocale() ? "zh" : "en";
}

/** For inline <head> boot (no ES modules). Must match detectDefaultLocale rules. */
export function bootLocaleInlineScript() {
  return `(function(){try{var s=localStorage.getItem("pi-trace-locale");var loc=s==="zh"||s==="en"?s:null;if(!loc){var langs=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||"en"];var zh=langs.some(function(l){return/^zh(-|$)/i.test(String(l));});var tz="";try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||"";}catch(e){}var cn=/^Asia\\/(Shanghai|Urumqi|Chongqing|Harbin|Kashgar)$/i.test(tz);loc=zh||cn?"zh":"en";}document.documentElement.lang=loc==="zh"?"zh-CN":"en";document.documentElement.dataset.locale=loc;}catch(e){document.documentElement.lang="en";document.documentElement.dataset.locale="en";}})();`;
}