/**
 * Supported locales for the mosoo App Console.
 *
 * The default locale is en-US. All date/number formatting should use the
 * current locale rather than hardcoded "en-US" — use the `useLocale()` hook
 * or the `useFormatDate()` / `useFormatNumber()` helpers.
 */
export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en";

/** Locale display names (in their own language). */
export const LOCALE_DISPLAY_NAMES: Record<SupportedLocale, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

/**
 * Returns the closest supported locale for a given language tag.
 * Falls back to DEFAULT_LOCALE.
 */
export function resolveLocale(raw: string): SupportedLocale {
  const normalized = raw.trim().toLowerCase();
  if (normalized.startsWith("zh") || normalized.startsWith("cn")) {
    return "zh-CN";
  }
  return DEFAULT_LOCALE;
}