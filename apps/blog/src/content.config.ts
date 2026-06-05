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
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    category: z.enum(CATEGORIES),
    author: z.string().default("Mosoo Team"),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
