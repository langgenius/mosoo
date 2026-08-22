import { loadTranslationCatalog } from "./catalogs";
import { DEFAULT_LOCALE, resolveLocale } from "./locales";
import type { SupportedLocale } from "./locales";

/**
 * Prepare only the selected translation resource before the first render.
 */
export async function initI18n(): Promise<void> {
  const locale = getCurrentLocale();
  await loadTranslationCatalog(locale);
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}

/**
 * Returns the locale persisted by the browser.
 */
export function getCurrentLocale(): SupportedLocale {
  const raw = typeof window === "undefined" ? DEFAULT_LOCALE : localStorage.getItem("mosoo-locale");
  return resolveLocale(raw ?? navigator.language);
}
