import type { SupportedLocale } from "@/shared/i18n/locales";

const DATE_FORMATTERS: Record<SupportedLocale, Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }),
  ja: new Intl.DateTimeFormat("ja-JP", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }),
  "zh-CN": new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }),
  "zh-TW": new Intl.DateTimeFormat("zh-TW", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }),
};

export function formatDate(iso: string, locale: SupportedLocale = "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return (DATE_FORMATTERS[locale] ?? DATE_FORMATTERS.en).format(d);
}

/**
 * Formats a count with compact notation for the given locale.
 * en: "2.1M", "21K" — zh-CN: "2.1万", "210万"
 */
export function formatCatalogCount(value: number, locale: SupportedLocale = "en"): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: value >= 1000 ? 1 : 0,
    notation: value >= 10_000 ? "compact" : "standard",
  }).format(value);
}
