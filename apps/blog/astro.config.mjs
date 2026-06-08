import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Blog is mounted at https://mosoo.ai/blog/*. apps/blog builds a static
// site that gets embedded into apps/web's deploy: `apps/web` build runs
// `apps/blog` build first, then copies `apps/blog/dist` into
// `apps/web/dist/blog/`. The same Cloudflare Worker (`mosoo-web`) serves
// both the SPA and the static blog content; `apps/web/src/worker.ts` forks
// the not-found path so `/blog/*` misses return a real 404 instead of the
// SPA shell. Astro's `base` ensures all generated URLs include the `/blog`
// prefix.
export default defineConfig({
  site: "https://mosoo.ai",
  base: "/blog",
  trailingSlash: "never",
  build: {
    // `directory` writes each route as <path>/index.html so URLs stay clean
    // and extensionless. Cloudflare Workers Assets resolves /blog/why-mosoo
    // to /blog/why-mosoo/index.html via the default `auto-trailing-slash`
    // html_handling, which keeps the canonical URL the user actually visits.
    format: "directory",
  },
  integrations: [mdx(), sitemap()],
  vite: {
    plugins: [tailwind()],
  },
});
