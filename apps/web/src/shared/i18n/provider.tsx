import { createContext, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { getTranslationCatalog, loadTranslationCatalog } from "./catalogs";
import type { TranslationTree, TranslationValue } from "./catalogs";
import { DEFAULT_LOCALE, resolveLocale } from "./locales";
import type { SupportedLocale } from "./locales";

type I18nContextValue = {
  language: SupportedLocale;
  changeLanguage: (language: SupportedLocale) => Promise<void>;
  t: (key: string, variables?: Record<string, string>) => string;
};

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
  const requestedLanguageRef = useRef(language);
  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      async changeLanguage(next) {
        requestedLanguageRef.current = next;
        await loadTranslationCatalog(next);
        if (requestedLanguageRef.current !== next) {
          return;
        }
        setLanguage(next);
        localStorage.setItem("mosoo-locale", next);
        document.documentElement.lang = next;
      },
      t(key, variables) {
        let text = lookup(getTranslationCatalog(language), key);
        if (text === key && language !== DEFAULT_LOCALE) {
          text = lookup(getTranslationCatalog(DEFAULT_LOCALE), key);
        }
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
