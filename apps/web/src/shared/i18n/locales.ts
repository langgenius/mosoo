/**
 * Supported locales for the mosoo Project Console.
 *
 * The default locale is en-US. All date/number formatting should use the
 * current locale rather than hardcoded "en-US" — use the `useLocale()` hook
 * or the `useFormatDate()` / `useFormatNumber()` helpers.
 */
export const SUPPORTED_LOCALES = ["en", "zh-CN", "zh-TW", "ja"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en";

/** Locale display names (in their own language). */
export const LOCALE_DISPLAY_NAMES: Record<SupportedLocale, string> = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
};

/**
 * Returns the closest supported locale for a given language tag.
 * Falls back to DEFAULT_LOCALE.
 */
export function resolveLocale(raw: string): SupportedLocale {
  const normalized = raw.trim().toLowerCase();
  if (normalized.startsWith("zh") || normalized.startsWith("cn")) {
    // zh-Hant / zh-TW → zh-TW; zh-Hans / zh-CN → zh-CN
    if (normalized.includes("hant") || normalized.includes("tw")) {
      return "zh-TW";
    }
    return "zh-CN";
  }
  if (normalized.startsWith("ja")) {
    return "ja";
  }
  return DEFAULT_LOCALE;
}
