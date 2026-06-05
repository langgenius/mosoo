import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Categories shown as tab pills on the index. Add new ones here and they show
// up automatically — frontmatter is validated against this list.
export const CATEGORIES = [
  "Engineering",
  "Product",
  "Research",
  "Customer Stories",
] as const;

const blog = defineCollection({
  loader: glob({
    pattern: ["**/*.{md,mdx}", "!README.md"],
    base: "./src/content/blog",
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    category: z.enum(CATEGORIES),
    author: z.string().default("mosoo team"),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
    // Custom hero image, optional. When set, the card and the article hero
    // render this image instead of the deterministic gradient. Convention:
    // store assets under `public/blog/<slug>/hero.<ext>` so they ship from
    // the blog worker at `/blog/blog/<slug>/hero.<ext>`. The path goes here
    // as a root-absolute URL — e.g. "/blog/blog/why-mosoo/hero.jpg".
    heroImage: z.string().optional(),
    heroAlt: z.string().optional(),
  }),
});

export const collections = { blog };
