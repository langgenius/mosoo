import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { DEFAULT_LOCALE, resolveLocale } from "./locales";
import type { SupportedLocale } from "./locales";
import en from "./translations/en.json";
import zhCN from "./translations/zh-CN.json";

type TranslationValue = string | Record<string, unknown>;
type TranslationTree = Record<string, TranslationValue>;

type I18nContextValue = {
  language: SupportedLocale;
  changeLanguage: (language: SupportedLocale) => void;
  t: (key: string, variables?: Record<string, string>) => string;
};

const resources: Record<SupportedLocale, TranslationTree> = { en, "zh-CN": zhCN };
const I18nContext = createContext<I18nContextValue | null>(null);

function lookup(tree: TranslationTree, key: string): string {
  const value = key.split(".").reduce<TranslationValue | undefined>((current, part) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, TranslationValue>)[part];
  }, tree);
  return typeof value === "string" ? value : key;
}

function detectInitialLocale(): SupportedLocale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  return resolveLocale(localStorage.getItem("mosoo-locale") ?? navigator.language);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<SupportedLocale>(detectInitialLocale);
  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      changeLanguage(next) {
        setLanguage(next);
        localStorage.setItem("mosoo-locale", next);
        document.documentElement.lang = next;
      },
      t(key, variables) {
        let text = lookup(resources[language], key);
        if (text === key && language !== DEFAULT_LOCALE) text = lookup(resources.en, key);
        return Object.entries(variables ?? {}).reduce(
          (result, [name, replacement]) => result.replaceAll(`{{${name}}}`, replacement),
          text,
        );
      },
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useTranslation must be used inside I18nProvider");
  return { i18n: context, t: context.t };
}
