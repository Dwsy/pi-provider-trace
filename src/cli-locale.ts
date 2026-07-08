import type { Locale } from "./web-ui-i18n.js";

/** Locale for /trace notifications and completions (Pi TUI, not Web UI). */
export function resolveCliLocale(): Locale {
	const forced = process.env.PI_PROVIDER_TRACE_LOCALE?.trim().toLowerCase();
	if (forced === "zh" || forced === "en") return forced;
	const lang = process.env.LANG || process.env.LC_ALL || "";
	return /^zh/i.test(lang) ? "zh" : "en";
}