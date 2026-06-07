import type { CollectionEntry } from "astro:content";

import type { LOCALES } from "../content.config";

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const localeLabels: Record<Locale, string> = {
  zh: "中文",
  en: "EN",
};

export const getPostLocale = (post: CollectionEntry<"blog">): Locale => post.data.locale;

export const getPostSlug = (post: CollectionEntry<"blog">): string =>
  post.data.permalink ?? post.id.replace(/-(en|zh)$/, "");

export const getPostPath = (post: CollectionEntry<"blog">): string => {
  const slug = getPostSlug(post);
  return getPostLocale(post) === DEFAULT_LOCALE ? slug : `${getPostLocale(post)}/${slug}`;
};

export const getPostHref = (post: CollectionEntry<"blog">, base: string): string =>
  `${base}/${getPostPath(post)}`;

export const getIndexHref = (locale: Locale, base: string): string =>
  locale === DEFAULT_LOCALE ? `${base || "/"}` : `${base}/${locale}`;

export const getLocaleFromPath = (pathname: string, base: string): Locale => {
  const normalizedBase = base.replace(/\/$/, "");
  const withoutBase =
    normalizedBase && pathname.startsWith(normalizedBase)
      ? pathname.slice(normalizedBase.length)
      : pathname;
  return withoutBase === "/zh" || withoutBase.startsWith("/zh/") ? "zh" : DEFAULT_LOCALE;
};

export const getAlternateLocaleHref = (
  pathname: string,
  base: string,
): { href: string; label: string } => {
  const normalizedBase = base.replace(/\/$/, "");
  const rawPath = pathname.replace(/\/$/, "") || normalizedBase || "/";
  const withoutBase =
    normalizedBase && rawPath.startsWith(normalizedBase)
      ? rawPath.slice(normalizedBase.length) || "/"
      : rawPath;
  const isChinese = withoutBase === "/zh" || withoutBase.startsWith("/zh/");
  const targetWithoutBase = isChinese
    ? withoutBase.replace(/^\/zh(?=\/|$)/, "") || "/"
    : `/zh${withoutBase === "/" ? "" : withoutBase}`;
  const href = `${normalizedBase}${targetWithoutBase}`.replace(/\/$/, "") || normalizedBase || "/";

  return {
    href,
    label: isChinese ? localeLabels.en : localeLabels.zh,
  };
};
