import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Blog is mounted at https://mosoo.ai/blog/* by a separate Cloudflare Worker
// (apps/blog/wrangler.toml binds the route pattern `mosoo.ai/blog*`). Astro's
// `base` ensures all generated URLs include the /blog prefix.
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
