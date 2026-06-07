import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

import { DEFAULT_LOCALE, getPostHref } from "../lib/i18n";

export const GET: APIRoute = async ({ site }) => {
  const posts = (
    await getCollection("blog", ({ data }) => !data.draft && data.locale === DEFAULT_LOCALE)
  ).toSorted((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  const siteRoot = (site?.href ?? "https://mosoo.ai/").replace(/\/$/, "");
  const base = `${siteRoot}/blog`;
  const items = posts
    .map((post) => {
      const url = `${siteRoot}${getPostHref(post, "/blog")}`;
      const pubDate = post.data.date.toUTCString();
      const escape = (s: string): string =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `
    <item>
      <title>${escape(post.data.title)}</title>
      <link>${url}</link>
      <guid>${url}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escape(post.data.description)}</description>
      <category>${escape(post.data.category)}</category>
    </item>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Mosoo Blog</title>
    <link>${base}</link>
    <description>Notes from the bamboo grove — engineering, product, and research from the team building Mosoo.</description>
    <language>en-us</language>${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
};
