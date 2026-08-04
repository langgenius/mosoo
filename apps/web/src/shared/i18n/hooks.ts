import { useTranslation } from "./provider";

import type { SupportedLocale } from "./locales";
import { DEFAULT_LOCALE } from "./locales";

/**
 * Returns the current locale for use with Intl formatters.
 * Prefer `useFormatDate` / `useFormatNumber` for common formatting needs.
 */
export function useLocale(): SupportedLocale {
  const { i18n } = useTranslation();
  return i18n.language === "zh-CN" ? "zh-CN" : DEFAULT_LOCALE;
}

/**
 * Returns locale-aware date formatting helpers. All returned formatters
 * respect the current locale rather than hardcoding "en-US".
 */
export function useFormatDate() {
  const locale = useLocale();

  return {
    /** Short date: "Jan 1, 2026" */
    dateShort(date: Date | string): string {
      const d = typeof date === "string" ? new Date(date) : date;
      if (Number.isNaN(d.getTime())) return String(date);
      return new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(d);
    },

    /** Date + time: "Jan 1, 2026, 3:04 PM" */
    dateTime(date: Date | string): string {
      const d = typeof date === "string" ? new Date(date) : date;
      if (Number.isNaN(d.getTime())) return String(date);
      return new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(d);
    },

    /** Time only: "3:04 PM" */
    time(date: Date | string): string {
      const d = typeof date === "string" ? new Date(date) : date;
      if (Number.isNaN(d.getTime())) return String(date);
      return new Intl.DateTimeFormat(locale, {
        hour: "numeric",
        minute: "2-digit",
      }).format(d);
    },

    /** Month + day: "Jan 1" */
    monthDay(date: Date | string): string {
      const d = typeof date === "string" ? new Date(date) : date;
      if (Number.isNaN(d.getTime())) return String(date);
      return new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
      }).format(d);
    },
  };
}

/**
 * Returns locale-aware number formatting helpers.
 */
export function useFormatNumber() {
  const locale = useLocale();

  return {
    /** Compact notation: "2.1M", "21K" (or "2.1万" in zh-CN) */
    compact(value: number): string {
      return new Intl.NumberFormat(locale, {
        maximumFractionDigits: value >= 1000 ? 1 : 0,
        notation: value >= 10_000 ? "compact" : "standard",
      }).format(value);
    },

    /** Standard notation with grouping: "1,234,567" */
    standard(value: number): string {
      return new Intl.NumberFormat(locale).format(value);
    },

    /** Currency: "$1,234.56" */
    currency(value: number, currency = "USD"): string {
      return new Intl.NumberFormat(locale, {
        currency,
        currencyDisplay: "symbol",
        style: "currency",
      }).format(value);
    },
  };
}