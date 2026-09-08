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
`--fg-1` (#333 default), `--fg-2`, `--fg-3` (subtle, AA on the sidebar tint),
`--fg-muted`; borders `--border-soft / -default / -strong`; actions
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

Three roles, three families:

- **Page titles and a few empty-state titles:** `--font-heading` = Instrument Sans
  (SIL OFL) at weight 500, 22-24px, -0.01em.
- **Everyday UI:** `--font-sans` = Geist at 13-14px; body base is 14px / 400.
- **Precise information (ids, model ids, masked keys, durations, versions):**
  `--font-mono` = IBM Plex Mono (SIL OFL) at 12-12.5px, tabular numerals, via
  `MonoText` or `data-slot="mono"`.

Type role classes: `.t-page-title`, `.t-section-title`, `.t-label`, `.t-body`,
`.t-body-sm`, `.t-caption`, `.t-eyebrow`, `.t-mono`, `.t-link`. CJK text falls back to
the system sans; the proof screenshots for the choice live under
`docs/design/assets/typography/`.

## Icons

Generic interface glyphs use Hugeicons Free through `src/shared/ui/icons.tsx`, with
`currentColor` and a 1.5px stroke by default. Use its semantic exports rather than
importing an icon library at a route. Brand marks, vendor/runtime/channel logos, the
eight-glyph sidebar family, state glyphs, and illustrations are purpose-built SVGs. The
boundary and every registration are listed in `docs/design/registry/icons.yml`.

## Spacing & Radius

Spacing scale `--s-1 (4px) … --s-24 (96px)`. Radius ladder `--r-xs 4 / -sm 6 /
-compact 8 / -md 10 / -lg 14 / -xl 20`. Nested corners step down one rung per level:
card or dialog 14, group or menu 10, compact control 8, row / badge / menu item 6, tag 4. **Cards top out at `--r-lg` (14px).** Full-pill is fine for switches and avatars only.

## Elevation & Motion

Shadows `--elev-xs … --elev-xl` (bridged to `shadow-*`), reserved for raised or
selected surfaces. Do not pair a 1px border with a wide shadow on the same element.
Durations `--dur-1 120 / -2 180 / -3 260 / -4 420ms`; shared controls transition only
`background-color, border-color, color, box-shadow` at 150ms; no `transition-all`, no
press scale. `prefers-reduced-motion` zeroes control transitions and replaces entrance
motion with fades.

## Components

Built on Base UI, shadcn-style, in `src/shared/ui/`. Density: Button 32px / 10px
(sm 28 / 8, xs 24 / 6, lg 36 / 10), Input and Select 32px / 10px, Badge 20px / 6px,
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
