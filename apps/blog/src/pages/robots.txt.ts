import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const origin = site?.origin ?? "https://mosoo.ai";
  const body = `User-agent: *
Allow: /

Sitemap: ${origin}/blog/sitemap-index.xml
`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
