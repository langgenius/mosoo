import type { SupportedLocale } from "./locales";
import en from "./translations/en.json";

export type TranslationValue = string | Record<string, unknown>;
export type TranslationTree = Record<string, TranslationValue>;

const loadedCatalogs = new Map<SupportedLocale, TranslationTree>([["en", en]]);
const catalogLoaders: Record<Exclude<SupportedLocale, "en">, () => Promise<TranslationTree>> = {
  ja: async () => (await import("./translations/ja.json")).default,
  "zh-CN": async () => (await import("./translations/zh-CN.json")).default,
  "zh-TW": async () => (await import("./translations/zh-TW.json")).default,
};

export function getTranslationCatalog(locale: SupportedLocale): TranslationTree {
  return loadedCatalogs.get(locale) ?? en;
}

export async function loadTranslationCatalog(locale: SupportedLocale): Promise<void> {
  if (loadedCatalogs.has(locale) || locale === "en") {
    return;
  }

  const load = catalogLoaders[locale];
  loadedCatalogs.set(locale, await load());
}
