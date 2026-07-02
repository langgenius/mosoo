# Blog posts

Each `.mdx` file in this directory becomes a post at `mosoo.ai/blog/<slug>`,
where `<slug>` is the filename without extension.

## Frontmatter schema

Validated by `src/content.config.ts`.

```yaml
---
title: "Post title"
description: "One- or two-sentence dek shown on the index card and metadata."
date: 2026-05-28
category: "Engineering" # Engineering | Product | Research | Customer Stories
author: "Mosoo team" # optional, defaults to "Mosoo team"
locale: "en" # en | zh, defaults to en
permalink: "post-title" # optional shared slug for localized posts
translationKey: "post-title" # optional key linking localized versions
titleAccent: "If" # optional colored substring in the title
featured: false # at most one true — wins the hero slot on the index
draft: false # true keeps the post out of the build
heroImage: "/blog/blog/<slug>/hero.jpg" # optional, see Images below
heroAlt: "..." # optional alt for heroImage
---
```

## Images

**Where to put them.** Drop assets under `apps/blog/public/blog/<slug>/`.
Cloudflare Workers Assets serves `public/` at the worker root and the worker
itself is mounted at `mosoo.ai/blog`, so a file at
`apps/blog/public/blog/the-journey-begins-with-an-imagine-if/hero.jpg` is served from
`https://mosoo.ai/blog/blog/the-journey-begins-with-an-imagine-if/hero.jpg`.

**How to reference them.** Use root-absolute URLs in frontmatter and MDX —
they survive base-path changes. Example:

```yaml
heroImage: "/blog/blog/the-journey-begins-with-an-imagine-if/hero.jpg"
heroAlt: "A young moso bamboo culm pushing through paper"
```

In the post body, use standard markdown:

```md
![A young moso bamboo culm pushing through paper](/blog/blog/the-journey-begins-with-an-imagine-if/hero.jpg)
```

Add a caption by wrapping in a `<figure>`:

```mdx
<figure>
  ![Alt text](/blog/blog/the-journey-begins-with-an-imagine-if/hero.jpg)
  <figcaption>A young moso bamboo culm pushing through paper.</figcaption>
</figure>
```

**Format.** Prefer WebP or AVIF for new photography. JPEG works fine for hero
images that were exported elsewhere. Compress before committing — anything
over ~500 KB should be downsized.

**Fallback.** A post without `heroImage` uses the deterministic
`gradient-from-slug` painterly card. Every post has a visual no matter what.

## Writing tips

- Sentence case in titles and headings. Use the brand casing the post needs,
  including `Mosoo` when it is a product name in prose.
- `description` shows up in the OG card, the index dek, and the search
  snippet. Make it stand alone.
- The first paragraph is the lede — write it like a magazine opener.
- Code samples render in JetBrains Mono on the carbon dark surface; keep
  them under ~80 chars per line so they don't scroll on mobile.
- Block-quotes pull in DM Sans display and bend left of the column — use
  sparingly, for a real quote or a thesis line.
