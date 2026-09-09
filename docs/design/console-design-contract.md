# Console design contract

Version: 1.1 (2026-09-09). Status: implemented for the shell plus the
Overview, Providers, Environments, MCP servers, Runs, the Skills empty state,
and the Settings surfaces; the rest of the console migrates recipe by recipe
(section 12). 1.1 consolidates typography to two families and re-cuts the text
tones, tracking, radius ladder, and elevation; the measurements behind it are
in [typography-audit.md](./typography-audit.md).

Sources: [langgenius/mosoo#599](https://github.com/langgenius/mosoo/issues/599)
(the contract and control-surface refactor),
[#601](https://github.com/langgenius/mosoo/issues/601) (nested corners,
layered borders, text levels), and
[#605](https://github.com/langgenius/mosoo/issues/605) (theme colour usage,
detailed in [theme-color-usage.md](./theme-color-usage.md)). The sidebar keeps
its own record in [console-sidebar.md](./console-sidebar.md) and consumes this
contract.

What it governs: the visual language of the Mosoo Console (web app) as tokens,
type roles, density, states, iconography, and motion. What it does not touch:
routes, permissions, API, GraphQL, data, the public website, or Mosoo Computer
(which may adopt the contract later, separately validated).

## 1. Layers and ownership

| Layer            | Owner                                                      | Contains                                                                                              | Rule                                                                                          |
| ---------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Primitive        | `apps/web/src/shared/styles/app.css`, `:root` top half     | green cluster, neutral ramps, status hues, type scale, spacing, radius ladder, elevation, motion      | Never consumed directly by components or routes.                                              |
| Semantic         | same file, `:root` second half and the `.dark` block       | canvas/surface, text roles, borders, interaction fills, actions, focus, controls, brand, status roles | Every role is defined in both theme blocks (gate test).                                       |
| Component recipe | `apps/web/src/shared/ui/*`                                 | Button, field, Select, Switch, Badge, rows, table, Dialog, menu, navigation, page header, empty state | Consumes semantic Tailwind classes only; no raw colour, no one-off type (gate test).          |
| Route code       | `apps/web/src/routes/*`, `src/features/*`, `src/domains/*` | composition                                                                                           | Consumes recipes and semantic classes; a raw value needs a sentence in the PR explaining why. |

The Tailwind bridge (`@theme inline`) turns semantic tokens into classes such
as `text-fg-2`, `bg-selected`, `border-border-strong`, `bg-primary`,
`text-success-fg`, `rounded-compact`, `font-heading`. Legacy aliases
(`bg-muted`, `text-muted-foreground`, `bg-accent`, `text-brand`, `bg-brand-light`,
`text-amber-fg`, and friends) still resolve so older call sites keep compiling;
new code does not add consumers of them.

## 2. Colour

### 2.1 Neutrals and surfaces

Pure neutral greys (oklch chroma 0), replacing the cool GitHub-like ramp. The
references behind #601 and the Apps cheatsheet behind #599 are pure neutral,
and a cast in the greys is one more thing to keep consistent across tints and
dark mode (Mintlify's tinted `#485450` was the option considered and set
aside).

| Role               | Light              | Dark                    | Use                                                               |
| ------------------ | ------------------ | ----------------------- | ----------------------------------------------------------------- |
| `--bg` (canvas)    | `#fafafa`          | `#1f1f1f`               | page canvas under white surfaces                                  |
| `--bg-elevated`    | `#ffffff`          | `#333333`               | cards, dialogs, menus, fields                                     |
| `--bg-sunken`      | `#f4f4f4`          | `#0d0d0d`               | nested groups, command blocks, segmented tracks                   |
| `--bg-sidebar`     | `#f4f4f4`          | `#0d0d0d`               | navigation column                                                 |
| `--hover`          | `rgba(0,0,0,.04)`  | `rgba(255,255,255,.06)` | hover fill on rows, menu items, ghost buttons (fine pointer only) |
| `--selected`       | `rgba(0,0,0,.065)` | `rgba(255,255,255,.10)` | selected navigation, selected row, open menu trigger              |
| `--pressed`        | `rgba(0,0,0,.09)`  | `rgba(255,255,255,.14)` | pressed fill                                                      |
| `--border-soft`    | `rgba(0,0,0,.06)`  | `rgba(255,255,255,.06)` | separators between rows, zone hairlines                           |
| `--border-default` | `rgba(0,0,0,.10)`  | `rgba(255,255,255,.10)` | card, dialog, menu, and list edges                                |
| `--border-strong`  | `rgba(0,0,0,.16)`  | `rgba(255,255,255,.18)` | controls that must read as controls: inputs, outline buttons      |

### 2.2 Text roles

| Role           | Light                    | Contrast on `#fff` / `#f4f4f4` | Dark                        | Contrast on `#1f1f1f` / `#333333` | Use                                                  |
| -------------- | ------------------------ | ------------------------------ | --------------------------- | --------------------------------- | ---------------------------------------------------- |
| `--fg-heading` | `#1f1f1f`                | 16.5 / 15.0                    | `#f5f5f5`                   | 15.1 / 11.6                       | page titles, section titles, row names               |
| `--fg-1`       | `#333333`                | 12.6 / 11.5                    | `#ebebeb`                   | 13.8 / 10.6                       | default text, control labels, values                 |
| `--fg-2`       | `rgba(51, 51, 51, 0.72)` | 5.3 / 5.0                      | `rgba(235, 235, 235, 0.72)` | 7.8 / 6.3                         | descriptions, helper text, secondary values          |
| `--fg-3`       | `rgba(51, 51, 51, 0.7)`  | 5.0 / 4.7                      | `rgba(235, 235, 235, 0.62)` | 6.1 / 5.1                         | captions, group labels, metadata                     |
| `--fg-muted`   | `rgba(51, 51, 51, 0.56)` | 3.3 / 3.2                      | `rgba(235, 235, 235, 0.45)` | 3.9 / 3.5                         | placeholders, disabled labels, decorative separators |

Hierarchy comes from the grey scale, never from glow or a heavier weight. The
ink is `#333`, never black, and off-white in dark, never `#fff`; every quieter
tone is an alpha of that ink so it keeps the cast of the surface under it.
Secondary sits at 72% of the ink. Subtle is 70% in light because that is the
AA floor on the `#f4f4f4` sidebar and row tint (0.66 blends to `#757575`,
4.2:1), so in light the third level is carried by size (12px captions, 11px
group labels) rather than by a lighter grey; dark has room for a real 0.62
step. `--fg-muted` is for text that is not required reading (3:1). The gate
test composites the alpha tokens over each surface in both themes before
taking the ratio.

### 2.3 Brand cluster

One hue, anchored on the logo mark, with a job per tone:

| Token                     | Light                          | Dark                   | Job                                                                                                |
| ------------------------- | ------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------- |
| `--action-primary-bg/-fg` | `#6fd305` / `#0f1a02` (9.4:1)  | same                   | the one focal action per surface; hover `#5cb300`, press `#55a600`; hairline `rgba(58,110,14,.35)` |
| `--brand-mark`            | `#6fd305`                      | `#6fd305`              | logo mark, the running pulse, the unread dot                                                       |
| `--focus-ring`            | `#498c07` (4.2:1)              | `#6fd305`              | keyboard focus, everywhere, nothing else                                                           |
| `--control-checked`       | `#498c07`                      | `#6fd305`              | checked switch track (and future checkbox/radio)                                                   |
| `--link/-hover`           | `#3a6e0e` / `#2c5113` (6.2:1)  | `#95dd2c` / `#b6e85f`  | action links, underlined                                                                           |
| `--brand/-soft`           | `#3a6e0e` on `#f4fce4` (5.8:1) | `#95dd2c` on 14% green | lifecycle badges with Mosoo-specific meaning: default key, default environment                     |

That list is the complete set of places the brand colour appears in the
console. Selection, hover, backgrounds, feedback badges, and the second button
on a surface are never green.

### 2.4 Status roles

Feedback colours, never brand. Success is a true green (hue 147) so that
"Authorized" and "the action" (hue 135) are never the same colour.

| Role    | Mark      | Text on tint (light)         | Dark text / tint                     | Glyph rule                                      |
| ------- | --------- | ---------------------------- | ------------------------------------ | ----------------------------------------------- |
| success | `#15b042` | `#0e6b33` on `#caface` (5.7) | `#7ee3a0` on `rgba(21,176,66,.16)`   | check                                           |
| warning | `#e0a106` | `#8a5a00` on `#fdf1cf` (5.3) | `#f5cf6b` on `rgba(224,161,6,.16)`   | alert triangle or star for "default"            |
| danger  | `#dc2a2a` | `#b91c1c` on `#fbeaea` (5.6) | `#f59a9a` on `rgba(220,42,42,.16)`   | x-circle; destructive buttons are solid         |
| info    | `#2f6bd4` | `#235fbe` on `#e8f0fd` (5.3) | `#9cc0f5` on `rgba(47,107,212,.18)`  | info circle                                     |
| pending | `#8a8a8a` | `#5c5c5c` on `#f4f4f4` (6.1) | `#b8b8b8` on `rgba(255,255,255,.08)` | power-off, dashed circle, clock                 |
| soil    | `#7a5230` | `#5b3c22` on `#f4ece2` (8.5) | `#d8b08a` on `rgba(122,82,48,.2)`    | warm neutral for restrictions (limited network) |

## 3. Typography

Two families, self-hosted and SIL OFL: Geist (`--font-sans`, and
`--font-heading` resolves to the same stack) and Geist Mono (`--font-mono`).
The audit that reduced five families to two, with the bytes each page fetched
before and after, is [typography-audit.md](./typography-audit.md).

| Role                | Family                    | Size / line / weight / tracking                     | Where                                                                                             |
| ------------------- | ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Page title          | `heading` = `sans` (Geist) | 24 / 28 / 500 / -0.02em (22px under 640px)         | `PageHeader` (`t-page-title`), the Org header                                                     |
| Title, one step down | Geist                    | 16 / 20 / 500 or 600 / -0.01em                      | empty-state titles (500), dialog titles (600), the profile name                                   |
| Section title       | Geist                     | 15 / 20 / 600 / -0.01em                             | card titles (`t-section-title`)                                                                   |
| Label               | Geist                     | 13 / 20 / 500 / 0                                   | `Label`, sidebar rows, row names                                                                  |
| Everyday UI         | Geist                     | 14 / 20 / 400 / 0; 13px inside controls             | descriptions, values, menu items, buttons                                                         |
| Caption             | Geist                     | 12 / 16 / 400 / 0 (table headers 500, `--fg-2`)     | helper text, table headers, metadata                                                              |
| Group label         | Geist                     | 12 / 16 / 500 / 0, sentence case (`t-group-label`)  | sidebar and settings navigation group labels; never tracked capitals                              |
| Precise information | `mono` = Geist Mono       | 12-12.5px / inherits / 400 / 0, tabular numerals    | ids, masked keys, model ids, durations, versions, command blocks (`MonoText`, `data-slot="mono"`) |

Rules: body weight is 400 (a 500 base made every line semi-bold and flattened
emphasis); headings never scale with the viewport; the heading voice is size,
weight, tracking, and the heading tone, never a second face or a heavier
weight; tracking scales with size (`--track-title` -0.02em at 22px and above,
`--track-subtitle` -0.01em from 15 to 20px, 0 in body, controls, and the
group label); line heights sit on the 4px grid at the size they pair with;
nothing is set in tracked capitals: group labels are sentence case
(`t-group-label`, 12px / 500), and no kicker sits above a heading
(`PageHeader` has no eyebrow slot); table headers are sentence case in the
`Table` recipe's 12px / 500; mono is for short precise
strings and one-line command blocks, never for descriptions or whole forms.
`index.html` preloads both files, `font-display: swap` keeps text visible, and
the `Geist Fallback` face maps local Arial onto Geist's metrics so the swap
does not reflow. CJK text falls back to the platform sans named in the
`:root:lang(zh)` stack (PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto
Sans CJK SC) in every role at the same weight, and no web font is fetched to
discover the missing glyphs
([proof](./assets/typography/geist/providers-zh-cn.png)).

### 3.1 The typography experiment

`just e2e ui typography-proof` renders Providers, Runs, the project settings
form, and the environment dialog with identical fixture data, colours, and
viewport, swapping only the heading and mono families, and writes the font
files each variant made the page fetch to `font-requests.json`. Contract 1.0
(2026-09-08) reviewed three variants, Geist / Geist Mono, General Sans / IBM
Plex Mono, and Instrument Sans / IBM Plex Mono, and chose the last. The
2026-09-09 audit re-ran the comparison with measurements and reversed it
(assets under [`assets/typography/`](./assets/typography/)):

| Variant         | Heading / mono                      | Providers                                                               | Specimen (2x)                                                                                                                      | Fetched on Providers                          |
| --------------- | ----------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| geist (shipped) | Geist 500 / Geist Mono              | [providers](./assets/typography/geist/providers-1440x900.png)           | [title](./assets/typography/geist/specimen-title-2x.png), [row](./assets/typography/geist/specimen-row-2x.png)                     | 2 files, 100,424 bytes                        |
| instrument-sans | Instrument Sans 500 / IBM Plex Mono | [providers](./assets/typography/instrument-sans/providers-1440x900.png) | [title](./assets/typography/instrument-sans/specimen-title-2x.png), [row](./assets/typography/instrument-sans/specimen-row-2x.png) | the shipped two plus the evaluated files      |

Stress cases for the shipped set: [Runs](./assets/typography/geist/runs-1440x900.png),
[project settings](./assets/typography/geist/settings-general.png),
[environment dialog](./assets/typography/geist/environment-dialog.png),
[zh-CN](./assets/typography/geist/providers-zh-cn.png).

Observations:

- At the baseline every console page fetched four files, 457,260 bytes, in
  both locales: Geist, Instrument Sans, IBM Plex Mono Regular, and Inter,
  which at 352,240 bytes was 77% of the total and drew nothing. Chromium
  downloads the next face in a stack as soon as a run holds a code point the
  earlier faces lack, so a fallback in `font-family` is fetched, not merely
  declared. The two-family page fetches 100,424 bytes, both files preloaded.
- At 24px / 500, Instrument Sans and Geist are interchangeable to the eye; the
  1.0 observation that Geist "reads as a larger body line" was a tracking and
  tone problem, not a family problem. With -0.02em, a 28px line, and the
  heading tone, the Geist title is a title, and the sans below it is the same
  family at 13-14px / 400, which is what the hierarchy rules ask for.
- Geist Mono shares Geist's vertical metrics (ascent 1005, descent 295,
  x-height 530 on 1000 units), so a 12.5px id sits on the baseline of its 13px
  label without an optical nudge; Plex Mono's slab texture is texture, not
  legibility, at that size.
- Chinese titles, labels, and descriptions render in PingFang SC in both
  variants, and the shipped variant fetches no web font to find that out.
- No layout shift: `font-display: swap` behind a metric-matched local
  fallback and a preload keeps the header height stable while the 29 KB and
  71 KB files load.

Decision: Geist for every sans role including page titles, Geist Mono for
precise information. Instrument Sans was retired as a third family without a
role only it can perform. IBM Plex Mono was retired because Geist Mono was
shipping as its fallback anyway, is lighter, and matches the UI face's
metrics. General Sans stays rejected on licensing: the ITF Free Font License
2.0 (17 Aug 2026) permits self-hosting for the licensee's own websites but
forbids distributing the files through "another font website, font library,
marketplace, repository, download service", which committing the binaries to
this public repository would be; loading it from the Fontshare API at runtime
is allowed but adds a third-party runtime dependency the console does not
otherwise have. Inter was dropped from the stacks and from the repository
(724 KB for two files that never rendered). Licences shipped next to the two
remaining files: Geist and Geist Mono are SIL OFL 1.1.

## 4. Density and component recipes

| Recipe                  | Measure                                                                                                       | File                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Button                  | default 32 / radius 6 / 13px; sm 28 / 4 / 12.5px (row actions); xs 24 / 4 / 12px (inline); lg 36 / 6 / 14px; flat at rest | `shared/ui/button.tsx`                |
| Icon button             | 32, 28, 24, 36 square, same radii                                                                             | same                                  |
| Field (Input, Textarea) | 32 / radius 6 / 13px, strong hairline, white surface, flat; textarea min 64                                   | `shared/ui/input.tsx`, `textarea.tsx` |
| Select trigger          | 32 / 6 / 13px, flat; popup radius 6 with `--elev-md`, items radius 4                                          | `shared/ui/select.tsx`                |
| Label                   | 13px / 500, 6px above its field                                                                               | `shared/ui/label.tsx`                 |
| Switch                  | 24 x 14 track, 10 thumb inset 2, no shadow                                                                    | `shared/ui/switch.tsx`                |
| Badge                   | 20 / radius 4 / 11.5px 600, 8px padding, 12px glyph                                                           | `shared/ui/badge.tsx`                 |
| Card                    | radius 6, hairline `--border-default`, `--bg-elevated`, 24px padding, no shadow (`rounded-lg border p-6`)     | route sections                        |
| `DataRow`               | min 40, 12px horizontal padding (16 in lists), 8px vertical; multiline grows by whole lines                   | `shared/ui/list-row.tsx`              |
| `ConnectionRow`         | min 44, 10px vertical; `tone="tinted"` inside cards (radius 4 on `--bg-sunken`)                               | same                                  |
| `RowList`               | radius 6, default hairline, rows divided by soft hairlines                                                    | same                                  |
| Table                   | header 40 / 12px 500 `--fg-2`, sentence case; rows 40, hover and selected fills                               | `shared/ui/table.tsx`                 |
| Sidebar row             | 32 / radius 6 / 13px (see console-sidebar.md)                                                                 | `shared/ui/sidebar.tsx`               |
| Sidebar call to action | 32 / radius 6, `--emphasis` fill (black) with `--emphasis-fg` text, flat; the sidebar's one filled control | `app/app-shell.tsx` |
| Dialog                  | radius 6, 24px padding, `--elev-lg`, title 16 / 20 / 600 / -0.01em, description 13px `--fg-2`, close 28 square radius 4 | `shared/ui/dialog.tsx`   |
| Menu                    | radius 6, 4px padding, `--elev-md`, items 13px radius 4, label 12px `--fg-3`                                  | `shared/ui/dropdown-menu.tsx`         |
| Segmented control       | 32 track on `--bg-sunken`, radius 6; checked segment white, radius 4, `--elev-xs`                             | `shared/ui/view-toggle.tsx`           |
| Page header             | `t-page-title`, description 13px `--fg-2`, `meta` beside the title (id badge), actions at default size        | `shared/ui/page-header.tsx`           |
| Empty state             | 48 icon tile, 16 / 20 / 500 / -0.01em title, 13px `--fg-3` sentence, one primary action                       | `shared/ui/empty-state.tsx`           |

### 4.1 State matrix

Interaction axis: rest, hover (fine pointer only, `hover:`), pressed
(`active:`), keyboard focus (`focus-visible:` ring). Condition axis: disabled,
readonly, loading, invalid, selected, open, editing.

| Recipe             | rest                                                   | hover                    | pressed       | keyboard focus                                | disabled                                               | other conditions                                                                                        |
| ------------------ | ------------------------------------------------------ | ------------------------ | ------------- | --------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Button primary     | green fill, ink text, deep hairline                    | `#5cb300`                | `#55a600`     | 2px `--focus-ring`, 1px offset                | `#ebebeb` fill, `--fg-3` text, no hairline, no shadow  | loading: `aria-busy`, spinner replaces the leading glyph, width unchanged                               |
| Button outline     | white, strong hairline, `--fg-1`                       | `--paper-100`            | `--paper-200` | ring                                          | `--paper-100`, soft hairline, `--fg-muted`             |                                                                                                         |
| Button ghost       | `--fg-2`, no fill                                      | `--hover`, `--fg-1`      | `--pressed`   | ring                                          | `--fg-muted`, no fill                                  |                                                                                                         |
| Button destructive | `--danger` fill, white                                 | 90%                      | 80%           | ring (same green ring; colour is not the cue) | `#ebebeb`, `--fg-3`                                    | always behind a confirm dialog when irreversible                                                        |
| Field              | white, strong hairline                                 |                          |               | border `--focus-ring` + 2px 30% glow          | `--paper-200`, soft hairline, `--fg-3`, not-allowed    | readonly: `--paper-100`, `--fg-2`; invalid: `--danger` border + `role="alert"` message, focus unchanged |
| Select             | as field                                               | `--paper-100`            |               | as field                                      | as field                                               | open: border `--focus-ring`; item highlighted `--hover`; item disabled `--fg-muted`                     |
| Switch             | track `--control-unchecked`, white thumb               |                          |               | ring, 2px offset                              | track `--paper-300` (off) / `#b6e85f` (on), thumb kept | checked: track `--control-checked`, thumb right                                                         |
| Badge              | tint + text tone, glyph                                | (links only) darker tint |               | ring when focusable                           | n/a                                                    | variants: default, outline, brand, success, warning, danger, info, pending, soil, destructive           |
| Row                | none                                                   | `--hover`                |               | child controls ring; row `z-index` lifts      | text `--fg-3` plus a pending badge, never opacity      | selected `--selected`; tinted rows hover to `--paper-300`                                               |
| Navigation row     | `--fg-2`                                               | `--hover`, `--fg-1`      | `--selected`  | ring, 1px offset on the sidebar surface       | `--fg-muted`, not-allowed, still labelled              | selected `--selected`, `--fg-1`, 600, `aria-current="page"`; open `--selected`                          |
| Segmented          | `--fg-3` on track                                      | `--fg-1`                 |               | ring on the checked segment                   | n/a                                                    | checked: white, `--elev-xs`, `aria-checked`; arrows move the choice                                     |
| Dialog             | white, default hairline, `--elev-lg`, 40% ink backdrop |                          |               | close button ring                             | n/a                                                    | open/close fade + 95% zoom, 200ms                                                                       |
| Menu               | white, default hairline, `--elev-md`                   | item `--hover`           |               | roving highlight                              | item `--fg-muted`                                      | destructive item `--danger-fg` on `--danger-bg` when highlighted                                        |

Rules that apply across recipes: the focus ring is the same ring everywhere
and is independent of invalid or error decoration; disabled content stays
legible (surface and text change, never a whole-control opacity); selected,
connected, warning, dangerous, and pending states carry a glyph, a label, or a
position as well as a colour; icon-only controls carry `aria-label`; a
single-choice view toggle is a `radiogroup`.

## 5. Radius, nesting, spacing, elevation

Cards are work surfaces, not pillows. Ladder: `--r-xs 2`, `--r-sm 4`,
`--r-md 6`, `--r-lg 6`. A child is never rounder than its parent (equal is
allowed), and nothing but a pill rounds past 6:

| Level                                                                                   | Radius | Example                                                        |
| --------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| Surface: card, dialog, menu, popover, list surface                                      | 6      | provider section card, `RowList`, dialog, Select popup         |
| Control at 32px and up: button, field, select, segmented track, sidebar row and call to action | 6 | `Input`, default `Button`, the sidebar's Create agent          |
| Nested: tinted row, badge, menu item, 24-28px control, dialog close, checked segment    | 4      | credential row inside a card, `Badge`, sm and xs buttons       |
| Tag, kbd, checkbox, tooltip arrow                                                       | 2      | eyebrow pills, the tooltip arrow                               |

The compact (8) and xl (20) rungs of contract 1.0 are gone; the gate test
fails on `rounded-xl`, `rounded-compact`, or an arbitrary radius above 6px
anywhere in `apps/web/src`. Spacing uses `--s-1 4 … --s-24 96`; information
cards and dialogs pad 24, rows 12 (16 in lists), the gap between a label and
its field is 6, between fields 12.

Elevation: the canvas (`#fafafa`) sits under white surfaces separated by
hairlines, and a resting surface is flat: no shadow on cards, fields, buttons,
rows, the switch thumb, the sidebar call to action, or the login card. Shadows
belong to floating layers and to the one raised control: `--elev-md` on menus
and popovers, `--elev-lg` on dialogs, `--elev-xl` on the sheet, `--elev-xs` on
the checked segment of a segmented control. The focus ring is the only
box-shadow a field or button ever carries. A 1px border and a wide (16px+)
shadow never share an element.

## 6. Icons

General interface glyphs come from Hugeicons Free through
`apps/web/src/shared/ui/icons.tsx` (1.5 stroke, `currentColor`, 16px inline,
20px in empty states). Purpose-built SVGs keep their own colour and never
stand in for a general glyph: the product marks, the eight-glyph sidebar
family, vendor and runtime marks, MCP channel avatars, run state glyphs, and
the login illustration. The registry is
[`registry/icons.yml`](./registry/icons.yml); the gate test fails when a
`createHugeicon` registration is missing from it. No emoji, no second icon
library.

## 7. Motion

Shared controls transition `background-color, border-color, color, box-shadow`
at 150ms ease-out; rows transition background only; dialogs and menus use
`tw-animate-css` fade/zoom at 200ms; the switch thumb translates at 150ms.
`transition-all` and press-scale are not used in shared UI (gate test).
`prefers-reduced-motion` zeroes control transitions, removes entrance
animations, and keeps the success check as a fade. Motion always communicates
a state change; nothing animates for decoration.

## 8. Accessibility

Text roles clear WCAG AA on white and on the `#f4f4f4` tint; badge text
clears 4.5:1 on its tint; the focus ring and checked track clear 3:1 on white.
The gate test computes these from the token values and the browser case
recomputes button and badge ratios on the rendered page, in light and dark.
Every state has a non-colour cue (section 4.1). All controls are reachable and
operable with the keyboard; the E2E case tabs to a button, focuses an invalid
field, and drives the segmented control with arrow keys through its radiogroup
semantics.

## 9. Evidence

Captured by `just e2e ui design-contract` with non-production fixture data
(`e2e/lib/console-fixtures.ts`). `before` is the checkout at `878535439b`
(contract 1.0); `after` is contract 1.1. The 1.0 evidence against
`a15b9d838a` is in the history of this file.

| Surface / state                                         | Before                                                         | After                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| Providers, 1440 x 900                                   | ![](./assets/contract/before/providers-1440x900.png)           | ![](./assets/contract/after/providers-1440x900.png)             |
| Providers, 390 x 844                                    | ![](./assets/contract/before/providers-390x844.png)            | ![](./assets/contract/after/providers-390x844.png)              |
| Providers, hover on "Add key"                           | ![](./assets/contract/before/providers-hover.png)              | ![](./assets/contract/after/providers-hover.png)                |
| Providers, keyboard focus on "Add key"                  | ![](./assets/contract/before/providers-keyboard-focus.png)     | ![](./assets/contract/after/providers-keyboard-focus.png)       |
| Credential dialog, rest                                 | ![](./assets/contract/before/providers-dialog.png)             | ![](./assets/contract/after/providers-dialog.png)               |
| Credential dialog, invalid after submit                 | ![](./assets/contract/before/providers-dialog-invalid.png)     | ![](./assets/contract/after/providers-dialog-invalid.png)       |
| Credential dialog, invalid field focused                | ![](./assets/contract/before/providers-dialog-invalid-focus.png) | ![](./assets/contract/after/providers-dialog-invalid-focus.png) |
| Overview, header recipe and flat onboarding card        | not captured before                                            | ![](./assets/contract/after/overview-1440x900.png)              |
| Environments, 40px data rows, CJK description           | ![](./assets/contract/before/environments-1440x900.png)        | ![](./assets/contract/after/environments-1440x900.png)          |
| Environment dialog, fields, select, switches            | ![](./assets/contract/before/environments-create-dialog.png)   | ![](./assets/contract/after/environments-create-dialog.png)     |
| MCP servers, 44px connection rows, success and disabled | ![](./assets/contract/before/mcp-1440x900.png)                 | ![](./assets/contract/after/mcp-1440x900.png)                   |
| MCP servers, hover                                      | ![](./assets/contract/before/mcp-hover.png)                    | ![](./assets/contract/after/mcp-hover.png)                      |
| Skills, empty state                                     | not captured before                                            | ![](./assets/contract/after/skills-empty-1440x900.png)          |
| Project settings, disabled primary                      | ![](./assets/contract/before/settings-general-disabled.png)    | ![](./assets/contract/after/settings-general-disabled.png)      |
| Project settings, enabled primary                       | ![](./assets/contract/before/settings-general-enabled.png)     | ![](./assets/contract/after/settings-general-enabled.png)       |
| Project settings, field focus                           | ![](./assets/contract/before/settings-general-input-focus.png) | ![](./assets/contract/after/settings-general-input-focus.png)   |
| Project API keys table                                  | ![](./assets/contract/before/settings-api-keys-1440x900.png)   | ![](./assets/contract/after/settings-api-keys-1440x900.png)     |
| Account settings, 390 x 844, read-only field            | ![](./assets/contract/before/settings-profile-390x844.png)     | ![](./assets/contract/after/settings-profile-390x844.png)       |
| Runs, working / done / failed rows                      | ![](./assets/contract/before/runs-1440x900.png)                | ![](./assets/contract/after/runs-1440x900.png)                  |
| Providers, dark token block                             | ![](./assets/contract/before/providers-dark-1440x900.png)      | ![](./assets/contract/after/providers-dark-1440x900.png)        |

## 10. Review gate

Automated:

- `apps/web/tests/console-design-contract-boundary.test.ts`: every semantic
  token in both themes; contrast of text and status pairs with the alpha text
  tones composited over each light surface, and the text tones over the dark
  canvas, card, and sidebar; the tones ordered (secondary about 72%, subtle
  below it, muted below that) and the ink never pure black or white; brand and
  success kept apart; neutral selection fills; Tailwind bridge, type roles,
  and the tracking tokens; exactly the two families declared with `swap`, the
  local metric fallback, only the two files plus their licences shipped, both
  preloaded, and no retired family named; the 2 / 4 / 6 radius ladder with no
  compact or xl rung and nothing in `apps/web/src` rounding past 6; no
  resting shadow in a shared recipe while menus and dialogs keep theirs;
  recipe measurements; one focus ring; no `transition-all`, press-scale, or
  disabled-opacity in shared UI; no raw colour in shared UI; every Hugeicons
  registration in the icon registry; no second icon library.
- `apps/web/tests/sidebar-hierarchy-boundary.test.ts` (unchanged): sidebar
  zones, resource icons, row recipe.
- `just e2e ui design-contract`: rendered measurements (button 32/6, badge
  20/4, switch 24x14/10, rows 40/44, card 6 with 24px padding and no shadow),
  nested radii, contrast on the page, focus ring presence, flat fields and
  buttons at rest, disabled without opacity, invalid with `role="alert"` and
  `aria-invalid`, narrow viewport without overflow, dark tokens, the two type
  families with the title role's 24 / 28 / 500 / -0.48px and the secondary
  tone read off the page, the Overview on the shared header recipe, and the
  Skills empty state; writes the evidence above.
- `just e2e ui typography-proof`: the shipped and the previous typography
  variants, with the font files each variant fetched; the shipped variant
  may fetch only the two Geist files, in `en` and in `zh-CN`.

Human, before opening the PR (mirrored in the pull request template): look at
every screenshot in every state before reading the diff; icons are Hugeicons
or a purpose-built family; colours, spacing, and radii come from tokens and a
raw value has a sentence explaining why; copy is read in context in every
locale; nothing decorative without an interaction purpose.

## 11. Decisions and rejected experiments

| Decision         | Chosen                                                    | Rejected                                                                                                                     |
| ---------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Neutral ramp     | Pure neutral                                              | The cool GitHub-like ramp (blue cast fought the green); brand-cast neutrals (Mintlify)                                       |
| Primary action   | Brand green fill, dark ink text, one per surface          | Black primary (brand invisible in the product); white text on mid greens (2.7:1); a `strong` black variant kept alongside    |
| Selection        | Neutral fill, weight change, `aria-current`               | Green selection fills; a green left bar                                                                                      |
| Sidebar "Create agent" | `--emphasis` (black) fill via the `--sidebar-cta-*` aliases (#616) | A brand-green sidebar control (two green fills on every screen); a quiet row (too easy to miss, per the #615 review) |
| Success          | Separate true green with a glyph                          | Brand green as success                                                                                                       |
| Checked controls | Deep brand tone (`#498c07`, 3:1 on white)                 | `#0077e6` blue from the cheatsheet (a second hue with no meaning here); the bright fill tone (2.7:1 against the white thumb) |
| Focus ring       | Solid `#498c07` 2px, 1px offset; fields use border + glow | 45% alpha bright green ring (1.5:1, invisible on the sidebar); a red ring on invalid fields                                  |
| Button radius    | 10 at 32px, stepping to 8 and 6 for smaller sizes         | 10 at every size (24px buttons became pills); 6 everywhere (cheatsheet's radius belonged to a 26px button)                   |
| Card radius      | 14 maximum                                                | 16-24 from the #601 references                                                                                               |
| Heading face     | Geist, the UI family, at 24 / 500 / -0.02em on a 28px line | Instrument Sans 500 (contract 1.0: a third family whose delta from Geist needs a 2x specimen to see, at a request per page); General Sans (licence forbids committing the files); Geist 600-800 (louder, not more distinct) |
| Mono face        | Geist Mono                                                | IBM Plex Mono (contract 1.0: a fine face, but Geist Mono shipped anyway as its fallback, two Plex weights cost 92 KB against one 71 KB file, and it shares no metrics with the UI face) |
| Sans fallback    | Metric-matched local Arial (`Geist Fallback`), then the platform sans; the platform CJK sans named per OS for `zh` | Inter as the second face (352 KB fetched on every page in both locales for glyphs it never drew) |
| Font delivery    | Two preloaded variable files, `swap`                      | Seven `@font-face` blocks across five families (963 KB shipped, 457 KB fetched per page)                                     |
| Body weight      | 400                                                       | 500 base (every line semi-bold, emphasis had nowhere to go)                                                                  |
| Text tones       | Alphas of the ink: 0.72 / 0.70 / 0.56 in light, 0.72 / 0.62 / 0.45 in dark | Hex greys `#5c5c5c` / `#707070` (secondary at 80% of the ink read as a second primary); a subtle tone under 0.70 (fails AA on the sidebar tint) |
| Tracking         | -0.02em on page titles, -0.01em at 15-20px, 0 in body, controls, and group labels | -0.01em on every title (contract 1.0); `tracking-tight` (-0.025em) on the onboarding hero; +0.06em tracked capitals on group labels |
| Kickers          | None; `PageHeader` has no eyebrow slot                    | The Overview's uppercase "PROJECT" over the project name; the 1.0 eyebrow slot                                               |
| Table headers    | The `Table` recipe: 12px / 500 / `--fg-2`, sentence case  | Four uppercase treatments across the API-keys, agents, cost, and logs tables                                                 |
| Radius           | 6 for surfaces and 32px controls, 4 nested, 2 for tags    | 14 / 10 / 8 / 6 / 4 (contract 1.0: pillow cards; 24px buttons became pills at 10)                                            |
| Shadows          | Floating layers and the checked segment only              | `--elev-xs` on resting cards, fields, buttons, the switch thumb, and the sidebar call to action                              |
| Card padding     | 24                                                        | 16                                                                                                                           |
| Row height       | 40 data / 44 connection as minimums                       | Fixed heights (clipped CJK descriptions and fork lines)                                                                      |

## 12. Migration

Done in 1.0: tokens and both theme blocks; Button, Input, Textarea,
Label, Select, Switch, Badge, Table, Dialog, Sheet, DropdownMenu, Tooltip,
PageHeader, EmptyState, ViewToggle, CommandBlock, the new `DataRow` /
`ConnectionRow` / `RowList` / `MonoText` recipes; the Providers, Environments
list, MCP servers list, Runs list, project settings (general, API keys),
account profile, and Org settings surfaces; the settings sub-navigations; the
agent detail tabs, agent grid, and skill cards (motion only).

Done in 1.1: the two-family typography with its fallback and preload; the
alpha text tones; the tracking and line-height tokens and the `t-*` roles on
them; the 6 / 4 / 2 radius ladder through every recipe and route (the compact
and xl rungs removed from the bridge); flat resting surfaces everywhere a
shadow was found, including the login card, the composers, the agent grid,
and the onboarding card; 24px information cards on Providers, the runtime
availability section, API tokens, the cost panels, and the skills catalog;
the Overview header on `PageHeader` with the new `meta` slot; group labels on
`t-group-label` (sentence case) in the sidebar and settings navigations;
table headers on the
`Table` recipe in the agents, API-keys, cost, and logs tables. Still on the
old uppercase micro-label style: the stat labels in the cost and agent cost
panels and a few agent-editor labels, to move to captions when those
surfaces migrate.

Next, in order of how often people see them: the agent editor form sections and
pickers, the agent list and status badges, the skills catalog, the environment
detail page, the threads composer and detail view, the onboarding and login
routes, then the remaining `bg-muted` / `text-muted-foreground` / `bg-accent`
/ `text-brand` aliases, which are retired once no consumer remains. Mosoo
Website and Mosoo Computer adopt the token layer and the recipes as a
document, with their own validation.

Known gaps for the first dark pass (the dark block maps every token but the
console has no toggle yet): vendor and runtime marks with black artwork need a
light tile on dark surfaces, the sidebar should switch to the on-dark wordmark,
and MCP channel avatars keep their fixed palette, which was tuned for light.
