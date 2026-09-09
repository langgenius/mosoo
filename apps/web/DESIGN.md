# Design

Visual system for the mosoo web app. Tokens are the source of truth and live in
`src/shared/styles/app.css` (`:root`, `.dark`, and the `@theme inline` Tailwind bridge).
The governing document is the
[Console design contract](../../docs/design/console-design-contract.md)
(`docs/design/console-design-contract.md`): primitives, semantic roles, and
component recipes, with the state matrix and the review gate. This file is the
short version.

## Theme

Light, neutral-first, calm. Pure neutral greys carry the surface (no cool or green
cast); the Moso-bamboo green is a disciplined accent that appears in a fixed, short
list of places: the logo mark, the one primary action per surface, the keyboard focus
ring, checked controls, action links, brand lifecycle badges, and two small live
markers. The sidebar's Create agent control is the neutral `--emphasis` fill (black),
never the brand green. Dark tokens (`.dark` / `[data-theme="dark"]`) map every role and are
captured in the design-contract E2E case, but the app does not yet expose a theme
toggle. The public landing page and blog are owned by the private
`langgenius/mosoo-website` repository.

## Color

Primitive ramps (authored as hex):

- **Green (brand cluster):** `--green-50 … --green-950`, anchored on the logo mark
  `--green-500 #6fd305`. Tones have jobs: 500 is the only large fill (dark ink text),
  700 the focus ring and checked track, 800 the text tone.
- **Ink (neutrals):** `--ink-50 … --ink-950`, pure neutral.
- **Paper (surfaces):** `--paper-50 … --paper-400`.
- **Status hues:** `--success-*` (true green, hue 147, distinct from the brand),
  `--amber-*`, `--ember-*`, `--sky-*`, `--soil-*`, each with mark, text, and tint tones.

Semantic roles: `--bg`, `--bg-elevated`, `--bg-sunken`, `--bg-sidebar`; interaction
fills `--hover`, `--selected`, `--pressed` (neutral, never green); text `--fg-heading`,
`--fg-1` (#333, never black; off-white in dark, never #fff), and the quieter tones as
alphas of that ink so hierarchy comes from the grey scale rather than weight:
`--fg-2` 0.72 (descriptions, 5.3:1 on white, 5.0:1 on the sidebar tint), `--fg-3` 0.70
(captions and group labels; the AA floor on the tint, so the third level is carried by
size), `--fg-muted` 0.56 (placeholders and disabled, 3:1 only); dark 0.72 / 0.62 / 0.45.
Borders `--border-soft / -default / -strong`; actions
`--action-primary-*`, `--emphasis`, `--link`, `--focus-ring`, `--control-checked`;
brand `--brand`, `--brand-soft`, `--brand-mark`; status `--success/--warning/--danger/--info/--pending` with `-fg` and `-bg`.
The rules for where each appears are in
[theme-color-usage.md](../../docs/design/theme-color-usage.md).

**Rule:** product code consumes Tailwind token classes (`text-fg-2`, `bg-selected`,
`border-border-strong`, `bg-brand-soft`, `text-success-fg`, ...). External brand
art, the terminal palette, and deterministic avatar palettes may use fixed colors
when they are not expressing a mosoo semantic state. Shared UI (`src/shared/ui`)
never contains a raw colour; the gate test fails the build if it does.

## Typography

Two families, both SIL OFL, self-hosted in `public/fonts` with their licences and
preloaded from `index.html` (the audit that got here from five families is
`docs/design/typography-audit.md`):

- **Every sans role, page titles included:** `--font-sans` = Geist; `--font-heading`
  resolves to the same stack. The heading voice is size, weight, tracking, and the
  heading tone, never a second face or a heavier weight: page title 24 / 28 / 500 /
  -0.02em (22px under 640px), section title 15 / 20 / 600 / -0.01em, dialog and
  empty-state titles 16 / 20 / -0.01em, labels 13 / 20 / 500, body 14 / 20 / 400 (13px
  inside controls), captions 12 / 16, the 11px uppercase group label at +0.06em. Body
  and control text never carry tracking. A `Geist Fallback` face maps local Arial onto
  Geist's metrics so the swap does not reflow.
- **Precise information (ids, model ids, masked keys, durations, versions):**
  `--font-mono` = Geist Mono at 12-12.5px, tabular numerals, via `MonoText` or
  `data-slot="mono"`. It shares Geist's vertical metrics, so mixed rows need no nudge.

Tokens: `--track-title` -0.02em, `--track-subtitle` -0.01em (Tailwind `tracking-title`
/ `tracking-subtitle`); body, controls, and group labels carry no tracking; line
heights on the 4px grid. Type role classes: `.t-page-title`, `.t-section-title`,
`.t-label`, `.t-body`, `.t-body-sm`, `.t-caption`, `.t-group-label` (sentence-case
group labels, 12px / 500; nothing in the console is set in tracked capitals, and no
kicker sits above a heading), `.t-mono`, `.t-link`. Table headers are the `Table` recipe's
12px / 500 sentence case. CJK text falls back to the platform sans named in the
`:root:lang(zh)` stack (PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK
SC) with no web font fetched to find the missing glyphs; the proof screenshots and the
font files each variant fetches live under `docs/design/assets/typography/`.

## Icons

Generic interface glyphs use Hugeicons Free through `src/shared/ui/icons.tsx`, with
`currentColor` and a 1.5px stroke by default. Use its semantic exports rather than
importing an icon library at a route. Brand marks, vendor/runtime/channel logos, the
eight-glyph sidebar family, state glyphs, and illustrations are purpose-built SVGs. The
boundary and every registration are listed in `docs/design/registry/icons.yml`.

## Spacing & Radius

Spacing scale `--s-1 (4px) … --s-24 (96px)`; information cards and dialogs pad 24.
Radius ladder `--r-xs 2 / -sm 4 / -md 6 / -lg 6`: cards are work surfaces, not
pillows. Surfaces (card, dialog, menu, popover, `RowList`) and their 32px controls
share the 6px corner; rows inside a card, badges, menu items, 24-28px controls, and
the checked segment step down to 4; tags, kbd, and the tooltip arrow sit at 2. A child
is never rounder than its parent. **Nothing but a pill rounds past 6px** (the gate test
fails on `rounded-xl`, `rounded-compact`, or an arbitrary radius above 6). Full-pill is
fine for switches and avatars only.

## Elevation & Motion

Resting surfaces are flat: no shadow on cards, fields, buttons, rows, the switch thumb,
or the sidebar call to action; the focus ring is the only box-shadow a control ever
carries. Shadows `--elev-xs … --elev-xl` (bridged to `shadow-*`) belong to floating
layers (menus and popovers `md`, dialogs `lg`, the sheet `xl`) and to the checked
segment of a segmented control (`xs`). Do not pair a 1px border with a wide shadow on
the same element.
Durations `--dur-1 120 / -2 180 / -3 260 / -4 420ms`; shared controls transition only
`background-color, border-color, color, box-shadow` at 150ms; no `transition-all`, no
press scale. `prefers-reduced-motion` zeroes control transitions and replaces entrance
motion with fades.

## Components

Built on Base UI, shadcn-style, in `src/shared/ui/`. Density: Button 32px / 6px
(sm 28 / 4, xs 24 / 4, lg 36 / 6), Input and Select 32px / 6px, Badge 20px / 4px,
Switch 24 x 14 with a 10px thumb, `DataRow` 40px, `ConnectionRow` 44px, sidebar row
32px. Every interactive recipe covers rest / hover / pressed / keyboard focus crossed
with disabled / readonly / loading / invalid / selected / open where they apply:
focus is one 2px ring, disabled changes surface and text (never opacity), invalid is a
danger border plus a `role="alert"` message that leaves the focus ring alone. Empty
states teach the surface (icon + heading + one sentence + primary action).

## Copy & Capitalization

- **Sentence case** for all UI strings: page titles, dialog titles, buttons, tabs,
  labels. Capitalize only the first word and proper nouns / acronyms (API, CSV, MCP,
  URL, OpenAI, GitHub). "Create agent", not "Create Agent"; "Access settings",
  not "Access Settings".
- Buttons are verb + object ("Save changes", "Delete project").
- No em dashes in user-facing copy. No marketing buzzwords. Avoid staccato slogan
  cadence (three+ short fragments in a row).
