# Console design contract

Version: 1.0 (2026-09-08). Status: implemented for the shell plus the
Providers, Environments, MCP servers, Runs, and Settings surfaces; the rest of
the console migrates recipe by recipe (section 12).

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

| Role           | Light     | Contrast on `#fff` / `#f4f4f4` | Dark      | Use                                                  |
| -------------- | --------- | ------------------------------ | --------- | ---------------------------------------------------- |
| `--fg-heading` | `#1f1f1f` | 16.5 / 15.0                    | `#ffffff` | page titles, section titles, row names               |
| `--fg-1`       | `#333333` | 12.6 / 11.5                    | `#fafafa` | default text, control labels, values                 |
| `--fg-2`       | `#5c5c5c` | 6.7 / 6.1                      | `#d6d6d6` | secondary values, descriptions in tables             |
| `--fg-3`       | `#707070` | 5.0 / 4.5                      | `#b8b8b8` | subtle copy, captions, eyebrows, helper text         |
| `--fg-muted`   | `#8a8a8a` | 3.5 / 3.1                      | `#8a8a8a` | placeholders, disabled labels, decorative separators |

The cheatsheet's `#777777` subtle text (4.48:1 on white) is pulled to `#707070`
so it still clears AA on the sidebar tint. `--fg-muted` is for text that is
not required reading.

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

| Role                | Family (`--font-*`)         | Size / weight / tracking                           | Where                                                                                             |
| ------------------- | --------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Page title          | `heading` = Instrument Sans | 24px (22px under 640px) / 500 / -0.01em            | `PageHeader`, the Org header, empty-state titles at 16px                                          |
| Section title       | `sans` = Geist              | 14-15px / 600                                      | card titles, dialog titles (16px)                                                                 |
| Label               | Geist                       | 13px / 500                                         | `Label`, sidebar rows, row names                                                                  |
| Everyday UI         | Geist                       | 14px body / 400; 13px inside controls              | descriptions, values, menu items, buttons                                                         |
| Caption / eyebrow   | Geist                       | 12px / 400; eyebrow 11px / 600 / +0.06em uppercase | helper text, table headers, section eyebrows                                                      |
| Precise information | `mono` = IBM Plex Mono      | 12-12.5px / 400, tabular numerals                  | ids, masked keys, model ids, durations, versions, command blocks (`MonoText`, `data-slot="mono"`) |

Rules: body weight is 400 (the previous 500 base made every line semi-bold and
flattened emphasis); headings never scale with the viewport; mono is for short
precise strings and one-line command blocks, never for descriptions or whole
forms; CJK text falls back to the system sans in every role, at the same
weight ([proof](./assets/typography/instrument-sans/providers-zh-cn.png)).

### 3.1 The typography experiment

`just e2e ui typography-proof` renders Providers, Runs, the project settings
form, and the environment dialog with identical fixture data, colours, and
viewport, swapping only the heading and mono families. Three variants were
reviewed on 2026-09-08 (assets under
[`assets/typography/`](./assets/typography/)):

| Variant         | Heading / mono                      | Providers                                                               | Specimen (2x)                                                                                                                      |
| --------------- | ----------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| current         | Geist 500 / Geist Mono              | [providers](./assets/typography/current/providers-1440x900.png)         | [title](./assets/typography/current/specimen-title-2x.png), [row](./assets/typography/current/specimen-row-2x.png)                 |
| general-sans    | General Sans 500 / IBM Plex Mono    | [providers](./assets/typography/general-sans/providers-1440x900.png)    | [title](./assets/typography/general-sans/specimen-title-2x.png), [row](./assets/typography/general-sans/specimen-row-2x.png)       |
| instrument-sans | Instrument Sans 500 / IBM Plex Mono | [providers](./assets/typography/instrument-sans/providers-1440x900.png) | [title](./assets/typography/instrument-sans/specimen-title-2x.png), [row](./assets/typography/instrument-sans/specimen-row-2x.png) |

Stress cases for the chosen set: [Runs](./assets/typography/instrument-sans/runs-1440x900.png),
[project settings](./assets/typography/instrument-sans/settings-general.png),
[environment dialog](./assets/typography/instrument-sans/environment-dialog.png),
[zh-CN](./assets/typography/instrument-sans/providers-zh-cn.png).

Observations:

- At 24px / 500 with -0.01em tracking, General Sans and Instrument Sans read
  as one voice: a compact, geometric title that is visibly a different thing
  from the 13-14px Geist UI below it. Geist at the same size and weight reads
  as a larger body line; the heading voice comes from the change of face plus
  the moderate weight, not from weight alone (the old 22-24px / 600-800 Geist
  titles were louder, not more distinct).
- IBM Plex Mono at 12.5px gives ids and masked keys a slab-serif texture that
  Geist Mono's rounder forms do not; numerals and units stay aligned with
  tabular figures. Perceived size matches Geist 13px labels on the same row.
- Chinese titles fall back to PingFang / the system sans at weight 500 in all
  three variants; row labels and descriptions are unaffected because the UI
  face is unchanged.
- No layout shift: `font-display: swap` with metric-compatible fallbacks
  (Geist, then system) keeps the header height stable while the files load
  (30 KB Instrument Sans variable, 46 KB per Plex Mono weight).

Decision: Instrument Sans 500 for headings, Geist for UI, IBM Plex Mono for
precise information. General Sans was rejected on licensing, not on looks: the
ITF Free Font License 2.0 (17 Aug 2026) permits self-hosting for the
licensee's own websites but forbids distributing the files through "another
font website, font library, marketplace, repository, download service", which
committing the binaries to this public repository would be. Loading it from
the Fontshare API at runtime is allowed but adds a third-party runtime
dependency the console does not otherwise have. An unused Cabinet Grotesk
binary (the same license) was removed from `apps/web/public/fonts` for the
same reason. Licences shipped next to the files: Instrument Sans and IBM Plex
Mono are SIL OFL 1.1; Geist and Geist Mono are SIL OFL 1.1; Inter is SIL OFL
1.1.

## 4. Density and component recipes

| Recipe                  | Measure                                                                                                       | File                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Button                  | default 32 / radius 10 / 13px; sm 28 / 8 / 12.5px (row actions); xs 24 / 6 / 12px (inline); lg 36 / 10 / 14px | `shared/ui/button.tsx`                |
| Icon button             | 32, 28, 24, 36 square, same radii                                                                             | same                                  |
| Field (Input, Textarea) | 32 / radius 10 / 13px, strong hairline, white surface; textarea min 64                                        | `shared/ui/input.tsx`, `textarea.tsx` |
| Select trigger          | 32 / 10 / 13px, popup radius 10, items radius 6                                                               | `shared/ui/select.tsx`                |
| Label                   | 13px / 500, 6px above its field                                                                               | `shared/ui/label.tsx`                 |
| Switch                  | 24 x 14 track, 10 thumb inset 2                                                                               | `shared/ui/switch.tsx`                |
| Badge                   | 20 / radius 6 / 11.5px 600, 8px padding, 12px glyph                                                           | `shared/ui/badge.tsx`                 |
| `DataRow`               | min 40, 12px horizontal padding (16 in lists), 8px vertical; multiline grows by whole lines                   | `shared/ui/list-row.tsx`              |
| `ConnectionRow`         | min 44, 10px vertical; `tone="tinted"` inside cards (radius 10 on `--bg-sunken`)                              | same                                  |
| `RowList`               | radius 14, default hairline, rows divided by soft hairlines                                                   | same                                  |
| Table                   | header 40 / 12px 500 `--fg-2`; rows 40, hover and selected fills                                              | `shared/ui/table.tsx`                 |
| Sidebar row             | 32 / radius 6 / 13px (see console-sidebar.md)                                                                 | `shared/ui/sidebar.tsx`               |
| Sidebar call to action | 32 / radius 10, `--emphasis` fill (black) with `--emphasis-fg` text; the sidebar's one filled control | `app/app-shell.tsx` |
| Dialog                  | radius 14, 24px padding, title 16px / 600, description 13px `--fg-2`, close 28 square                         | `shared/ui/dialog.tsx`                |
| Menu                    | radius 10, 4px padding, items 13px radius 6, label 12px `--fg-3`                                              | `shared/ui/dropdown-menu.tsx`         |
| Segmented control       | 32 track on `--bg-sunken`, radius 10; checked segment white, radius 8, `--elev-xs`                            | `shared/ui/view-toggle.tsx`           |
| Page header             | title role, description 13px `--fg-2`, actions at default size                                                | `shared/ui/page-header.tsx`           |
| Empty state             | 48 icon tile, 16px heading role, 13px `--fg-3` sentence, one primary action                                   | `shared/ui/empty-state.tsx`           |

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

Ladder: `--r-xs 4`, `--r-sm 6`, `--r-compact 8`, `--r-md 10`, `--r-lg 14`,
`--r-xl 20`. Nesting steps down one rung per level and a child is never
rounder than its parent:

| Level                                                 | Radius | Example                                           |
| ----------------------------------------------------- | ------ | ------------------------------------------------- |
| Page card, dialog, list surface                       | 14     | provider section card, `RowList`, dialog          |
| Group, menu, popup, tinted row, field, default button | 10     | credential row inside a card, Select popup, Input |
| Compact control, dialog close, segment                | 8      | sm buttons, icon-sm buttons, checked segment      |
| Badge, menu item, sidebar row, flat row               | 6      | `Badge`, `DropdownMenuItem`, sidebar rows         |
| Tag, checkbox, monogram                               | 4      | eyebrow pills                                     |

Cards never round past 14 (the 24-40px corners in the #601 references are a
marketing-page scale; at console density they read as pills). Spacing uses
`--s-1 4 … --s-24 96`; cards pad 16, dialogs 24, rows 12 (16 in lists), the
gap between a label and its field is 6, between fields 12.

Elevation: the canvas (`#fafafa`) sits under white surfaces separated by
hairlines. Shadows are for raised or selected surfaces only: `--elev-xs` on
fields, outline buttons, and the checked segment; `--elev-md` on menus;
`--elev-lg` on dialogs. A 1px border and a wide (16px+) shadow never share an
element.

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
(`e2e/lib/console-fixtures.ts`). `before` is the checkout at
`a15b9d838a`; `after` is this change.

| Surface / state                                         | Before                                                         | After                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| Providers, 1440 x 900                                   | ![](./assets/contract/before/providers-1440x900.png)           | ![](./assets/contract/after/providers-1440x900.png)             |
| Providers, 390 x 844                                    | ![](./assets/contract/before/providers-390x844.png)            | ![](./assets/contract/after/providers-390x844.png)              |
| Providers, hover on "Add key"                           | ![](./assets/contract/before/providers-hover.png)              | ![](./assets/contract/after/providers-hover.png)                |
| Providers, keyboard focus on "Add key"                  | ![](./assets/contract/before/providers-keyboard-focus.png)     | ![](./assets/contract/after/providers-keyboard-focus.png)       |
| Credential dialog, rest                                 | ![](./assets/contract/before/providers-dialog.png)             | ![](./assets/contract/after/providers-dialog.png)               |
| Credential dialog, invalid after submit                 | ![](./assets/contract/before/providers-dialog-invalid.png)     | ![](./assets/contract/after/providers-dialog-invalid.png)       |
| Credential dialog, invalid field focused                | not reachable before (no `aria-invalid`)                       | ![](./assets/contract/after/providers-dialog-invalid-focus.png) |
| Environments, 40px data rows, CJK description           | ![](./assets/contract/before/environments-1440x900.png)        | ![](./assets/contract/after/environments-1440x900.png)          |
| Environment dialog, fields, select, switches            | not captured before (switches hidden until Limited)            | ![](./assets/contract/after/environments-create-dialog.png)     |
| MCP servers, 44px connection rows, success and disabled | ![](./assets/contract/before/mcp-1440x900.png)                 | ![](./assets/contract/after/mcp-1440x900.png)                   |
| MCP servers, hover                                      | not captured before                                            | ![](./assets/contract/after/mcp-hover.png)                      |
| Project settings, disabled primary                      | ![](./assets/contract/before/settings-general-disabled.png)    | ![](./assets/contract/after/settings-general-disabled.png)      |
| Project settings, enabled primary                       | ![](./assets/contract/before/settings-general-enabled.png)     | ![](./assets/contract/after/settings-general-enabled.png)       |
| Project settings, field focus                           | ![](./assets/contract/before/settings-general-input-focus.png) | ![](./assets/contract/after/settings-general-input-focus.png)   |
| Project API keys table                                  | not captured before                                            | ![](./assets/contract/after/settings-api-keys-1440x900.png)     |
| Account settings, 390 x 844, read-only field            | ![](./assets/contract/before/settings-profile-390x844.png)     | ![](./assets/contract/after/settings-profile-390x844.png)       |
| Runs, working / done / failed rows                      | ![](./assets/contract/before/runs-1440x900.png)                | ![](./assets/contract/after/runs-1440x900.png)                  |
| Providers, dark token block                             | not captured before                                            | ![](./assets/contract/after/providers-dark-1440x900.png)        |

## 10. Review gate

Automated:

- `apps/web/tests/console-design-contract-boundary.test.ts`: every semantic
  token in both themes; contrast of text and status pairs; brand and success
  kept apart; neutral selection fills; Tailwind bridge and type roles; recipe
  measurements; one focus ring; no `transition-all`, press-scale, or
  disabled-opacity in shared UI; no raw colour in shared UI; every Hugeicons
  registration in the icon registry; no second icon library.
- `apps/web/tests/sidebar-hierarchy-boundary.test.ts` (unchanged): sidebar
  zones, resource icons, row recipe.
- `just e2e ui design-contract`: rendered measurements (button 32/10, badge
  20/6, switch 24x14/10, rows 40/44), nested radii, contrast on the page,
  focus ring presence, disabled without opacity, invalid with `role="alert"`
  and `aria-invalid`, narrow viewport without overflow, dark tokens, type
  families; writes the evidence above.
- `just e2e ui typography-proof`: the three typography variants.

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
| Heading face     | Instrument Sans 500                                       | General Sans (licence forbids committing the files); Geist 600-800 (louder, not more distinct)                               |
| Mono face        | IBM Plex Mono                                             | Keeping Geist Mono (fine, but Plex Mono separates ids from labels better at 12.5px)                                          |
| Body weight      | 400                                                       | 500 base (every line semi-bold, emphasis had nowhere to go)                                                                  |
| Subtle text      | `#707070`                                                 | `#777777` from the cheatsheet (4.48:1 on white, 4.2 on the sidebar tint)                                                     |
| Row height       | 40 data / 44 connection as minimums                       | Fixed heights (clipped CJK descriptions and fork lines)                                                                      |

## 12. Migration

Done in this change: tokens and both theme blocks; Button, Input, Textarea,
Label, Select, Switch, Badge, Table, Dialog, Sheet, DropdownMenu, Tooltip,
PageHeader, EmptyState, ViewToggle, CommandBlock, the new `DataRow` /
`ConnectionRow` / `RowList` / `MonoText` recipes; the Providers, Environments
list, MCP servers list, Runs list, project settings (general, API keys),
account profile, and Org settings surfaces; the settings sub-navigations; the
agent detail tabs, agent grid, and skill cards (motion only).

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
