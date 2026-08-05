import { DEFAULT_LOCALE, resolveLocale } from "./locales";
import type { SupportedLocale } from "./locales";

/**
 * Prepare the bundled translation resources before the first render.
 */
export function initI18n(): Promise<void> {
  if (typeof document !== "undefined") {
    document.documentElement.lang = getCurrentLocale();
  }
  return Promise.resolve();
}

/**
 * Returns the locale persisted by the browser.
 */
export function getCurrentLocale(): SupportedLocale {
  const raw = typeof window === "undefined" ? DEFAULT_LOCALE : localStorage.getItem("mosoo-locale");
  return resolveLocale(raw ?? navigator.language);
}
