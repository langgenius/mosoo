# Design

Visual system for the Mosoo web app. Tokens are the source of truth and live in
`src/shared/styles/app.css` (`:root`, `.dark`, and the `@theme inline` Tailwind bridge).
This document describes them; the CSS implements them.

## Theme

Light, neutral-first, GitHub-like. Cool grays carry the surface; a bright Moso-bamboo
green is a disciplined accent only. Primary actions are black (`--ink-900`) in the
shipped light UI. Dark selector tokens (`.dark` / `[data-theme="dark"]`) are authored
as a future-ready palette, but the app does not currently activate or expose a dark
theme. The public landing page and blog are owned by the private
`langgenius/mosoo-website` repository.

## Color

Token ramps (OKLCH-intent, authored as hex):

- **Green (brand):** `--green-50 … --green-950`, focal `--green-500 #6fd305`.
- **Ink (neutrals):** `--ink-50 … --ink-950`, true cool grays, no green cast.
- **Paper (surfaces):** `--paper-50 … --paper-400`, cool near-whites.
- **Status:** `--soil/--sky/--amber/--ember` each with paired `_fg` (readable text) and
  `_bg` (soft tint) so chips render legible copy; `--success/--info/--warning/--danger`.

Semantic roles: `--bg`, `--bg-elevated`, `--bg-sunken`, `--bg-canvas`, `--bg-sidebar`;
text `--fg-1` (primary), `--fg-2` (secondary), `--fg-3` (tertiary), `--fg-muted`,
`--fg-inverse`; borders `--border-soft / -default / -strong`; `--primary` (black),
`--accent` (green-500) with hover/press/soft/ring variants. Color strategy is
**Restrained**: accent only for the one focal action, current selection, and state.
Selection fills are neutral (`--color-brand-light` = ink-50), not green washes.

**Rule:** product semantic colors consume Tailwind token classes (`text-fg-2`,
`bg-paper-200`, `border-border-strong`, `bg-accent-soft`, etc.). External brand
art, the terminal palette, and deterministic avatar palettes may use fixed colors
when they are not expressing a Mosoo semantic state.

## Typography

Families (cap at 3): `--font-sans` / `--font-display` = Geist → Inter → system;
`--font-mono` = Geist Mono. Product UI uses one sans with weight contrast.

Fixed rem scale (not fluid in product UI): `--fs-12 … --fs-64`. Line heights
`--lh-tight/-snug/-normal/-loose`. Type component classes: `.h-display/.h1/.h2/.h3/.h4`,
`.t-body/.t-body-sm/.t-caption/.t-micro/.t-eyebrow/.t-mono/.t-link`. Base body is
`--fs-15` / weight 500 with `ss01`. Product headings stay fixed.

## Spacing & Radius

Spacing scale `--s-1 (4px) … --s-24 (96px)`. Radius `--r-xs 4 / -sm 6 / -md 10 / -lg 14
/ -xl 20`. **Cards top out at `--r-lg` (14px); never round cards past ~16px.** Full-pill
is fine for tags and toggles only.

## Elevation & Motion

Shadows `--shadow-xs … --shadow-xl`, `--shadow-inset`, `--shadow-focus`. Do not pair a
1px border with a wide (≥16px blur) shadow on the same element. Easing
`--ease-out/-in-out/-spring`; durations `--dur-1 120 / -2 180 / -3 260 / -4 420ms`.
Product transitions stay in the 120–260ms band and convey state, not decoration. New
animations must include a `prefers-reduced-motion` fallback; this document does not
claim every existing motion path has been audited.

## Components

Built on Base UI, shadcn-style, in `src/shared/ui/`. `button.tsx` (variants:
default/accent/destructive/ghost/link/outline/secondary/tonal; sizes xs–lg + icon),
`badge.tsx`, `dialog.tsx`, `input.tsx`, `textarea.tsx`, `table.tsx`, `empty-state.tsx`,
`page-header.tsx`, `dropdown-menu.tsx`, `tooltip.tsx`, `switch.tsx`,
`view-toggle.tsx`, and more. Every interactive component must cover default / hover /
focus / active / disabled, plus loading / empty / error where it applies. Empty states
teach the surface (icon + heading + one sentence + primary action), and they are
uniform across list pages.

## Copy & Capitalization

- **Sentence case** for all UI strings: page titles, dialog titles, buttons, tabs,
  labels. Capitalize only the first word and proper nouns / acronyms (API, CSV, MCP,
  URL, OpenAI, GitHub, Slack). "Create agent", not "Create Agent"; "Access settings",
  not "Access Settings".
- Buttons are verb + object ("Save changes", "Delete app").
- No em dashes in user-facing copy. No marketing buzzwords. Avoid staccato slogan
  cadence (three+ short fragments in a row).
