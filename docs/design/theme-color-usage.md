# Theme colour usage

Status: research and rules for
[langgenius/mosoo#605](https://github.com/langgenius/mosoo/issues/605). The
rules here are the colour section of the
[Console design contract](./console-design-contract.md); the contract's tokens
implement them. This page records the evidence the rules were derived from.

## 1. Method

Public pages of Supabase and Mintlify were rendered in headless Chromium at
1440 x 900 in both colour schemes on 2026-09-08 (UTC+8) and every button,
link, heading, input, and focused element had its computed styles read back,
so the observations below are measured values rather than impressions. The
probe is `e2e/tools/theme-color-probe.ts` (`bun e2e/tools/theme-color-probe.ts`
writes the screenshots and a JSON report to `.tmp/design/theme-color-probe/`).
Green is counted when the hue sits between 120 and 175 degrees at saturation
0.3 or more.

| Page                                          | Green buttons / buttons (light) | Green links / links (light) |
| --------------------------------------------- | ------------------------------- | --------------------------- |
| supabase.com                                  | 1 / 16                          | 0 / 42                      |
| supabase.com/pricing                          | 2 / 57                          | 4 / 24                      |
| supabase.com/docs                             | 0 / 10                          | 5 / 71                      |
| supabase.com/dashboard/sign-in (Studio shell) | 1 / 4                           | 0 / 5                       |
| mintlify.com                                  | 0 / 11                          | 0 / 31                      |
| mintlify.com/pricing                          | 1 / 19                          | 0 / 23                      |
| mintlify.com/docs                             | 1 / 40                          | 0 / 1                       |
| dashboard.mintlify.com/login (product shell)  | 0 / 4                           | 0 / 5                       |

## 2. Observations

### Supabase

| #   | Location (2026-09-08)                            | Observation                                                                                                                                                                                                                                        | Purpose                                                        | Reusable principle                                                                                                                |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| S1  | `/dashboard/sign-in`, "Sign in" button           | Fill `#72e3ad` (oklch 0.835 0.130 161), text near-black `oklch(0.1 0 34)`, 1px border `oklab(0.686 -0.144 0.058 / 0.75)`, 6px radius, 42px tall. The three "Continue with ..." buttons beside it are transparent with a `rgba(ink, 0.146)` border. | The one focal action on the surface.                           | A light brand fill with dark text and a deeper-tone hairline reads as "the" action; everything else on the surface stays neutral. |
| S2  | `/pricing`, "Add Project" and "Subscribe"        | Same `#72e3ad` recipe at 26px; "Compare Plans" next to them is black on white; plan tabs "Pro" / "Team" are neutral fills `oklch(0.1 0 34 / 0.054)`.                                                                                               | One brand button per pricing card; navigation stays neutral.   | Selected tabs and segmented controls never use the brand colour; the brand colour is spent on the action, not on "where am I".    |
| S3  | `/docs`, inline links                            | Body links are neutral `oklch(0.394 0 34)` (no underline); a handful of call-to-action links ("Contact support", "See Changelog") are `#0a844e`, a deep green with 4.9:1 on white.                                                                 | Distinguish the few links that move the reader out of the doc. | Green text is a deep tone, never the fill tone; it is used for a handful of outbound actions, not for every link.                 |
| S4  | `/docs` and `/dashboard/sign-in`, keyboard focus | `box-shadow: <surface> 0 0 0 2px, oklch(0.76 0.15 <green>) 0 0 0 4px`: a 2px surface-coloured gap then a 2px green ring.                                                                                                                           | Keyboard focus.                                                | One focus ring for every control, offset from the control so it reads on any fill including the green button.                     |
| S5  | Home hero, "Table Editor" tab and framework tabs | Selected tab: white fill, `oklch(0.1 0 34)` (near-black) border; unselected: transparent with a `rgba(ink, 0.08)` border.                                                                                                                          | Selection.                                                     | Selection is neutral and stronger in value, not in hue.                                                                           |
| S6  | Dark scheme, `/dashboard/sign-in` and `/pricing` | Primary fill becomes `#006239` with near-white text and a `oklab(0.76 -0.14 0.05 / 0.3)` border; links `#3ecf8e` underlined; body `oklch(0.19 0.0025 159)`.                                                                                        | Dark mapping.                                                  | In dark the fill drops to a deep tone and the text tone lifts to the bright one; the ring stays the bright tone.                  |

Typography aside: Supabase sets headings in Manrope 500/600, body in Inter,
and pricing tier names in Source Code Pro 450 at 22px, which is the same
"quiet UI face, distinct heading face, mono for precise labels" split the
contract adopts.

### Mintlify

| #   | Location (2026-09-08)                      | Observation                                                                                                                                                                                                        | Purpose                                    | Reusable principle                                                                                                                     |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `dashboard.mintlify.com/login`, "Continue" | `#111111` fill, `#fcfcfc` text, 6px radius, 32px tall; the two "Continue with ..." buttons are white with a `#e7e5e4` border at the same height; the logo mark is the only green on the page.                      | The product shell's primary action.        | A product can keep primary actions neutral and still be recognisably on-brand through the mark and the focus tone alone.               |
| M2  | `/pricing`, "Annual" billing toggle        | Selected segment: `#0c8c5e` text on `#0c8c5e` at 8% alpha, 2px radius; unselected "Monthly": `#485450` text, no fill.                                                                                              | A single-choice toggle.                    | A soft tint (8%) plus the deep text tone marks the selected option without a solid fill; `#485450` shows neutrals tinted toward brand. |
| M3  | `/docs`, sidebar current page              | Current item text `#166e3f` (`--primary: 22 110 63`), no fill; hover fill `oklab(0.155 -0.005 0.0006 / 0.03)`; the consent button "Accept All" is `#166e3f` with white text and a full pill.                       | "Where am I" inside docs; one solid CTA.   | The deep tone works for text at 12-14px (7.3:1 on white); the solid version appears once per page.                                     |
| M4  | `/` and `/pricing`, keyboard focus         | `outline: lab(51.3 -41.6 15.4) 2px` (a mid green) on marketing pages; the docs shell uses a neutral 1px auto outline.                                                                                              | Keyboard focus.                            | The focus ring is brand-coloured even where nothing else is.                                                                           |
| M5  | `/`, body and headings                     | Body `#000000` on `lab(100 0 0)`; secondary copy `lab(2.4 -0.17 -0.47 / 0.6)`; headings `arizonaFlare` 50px/400 then Inter 500 at 24-36px; neutral greys such as `#485450` and `#121715` carry a faint green cast. | Hierarchy through size, weight, and alpha. | Neutral-first hierarchy; a barely-there brand cast in the greys is optional and easy to overdo.                                        |
| M6  | Dark scheme, `/docs` current page and CTA  | `--primary-light: 38 189 108` (`#26bd6c`) for the current item text and the solid CTA with `#0a0d0c` text.                                                                                                         | Dark mapping.                              | Dark mode lifts the brand tone; fills switch to dark text on the bright tone.                                                          |

## 3. What transfers to Mosoo and what stays on marketing pages

| Rule                                                                           | Console | Marketing only | Source                                       |
| ------------------------------------------------------------------------------ | ------- | -------------- | -------------------------------------------- |
| One brand-filled action per surface, dark text on the fill, deep-tone hairline | yes     |                | S1, S2                                       |
| Neutral selected states (tabs, navigation, table rows)                         | yes     |                | S5, M3                                       |
| Brand-coloured keyboard focus ring, offset from the control                    | yes     |                | S4, M4                                       |
| Deep brand tone for the few links that are actions; body links stay neutral    | yes     |                | S3, M3                                       |
| Checked controls in the brand cluster, deep enough for 3:1 on white            | yes     |                | S1 (toggles in Studio follow the same green) |
| Dark mapping: fill keeps dark text; text tone lifts to the bright tone         | yes     |                | S6, M6                                       |
| Full-pill CTAs, 38-42px heights                                                |         | yes            | S1, M3                                       |
| Gradient or tinted hero surfaces, brand-cast neutrals                          |         | yes            | M5                                           |
| Display typefaces at 44-50px                                                   |         | yes            | M5                                           |

Two things neither site does, and Mosoo does not either: colour a whole row or
card with the brand tint to mean "selected", and use the brand green as the
success colour. Success on Supabase's product surfaces and on the Apps
cheatsheet referenced by #599 is a distinct true green.

## 4. Mosoo colour roles

Tokens live in `apps/web/src/shared/styles/app.css`; the table uses the
semantic names and the Tailwind class that consumes them. Light values are
listed; dark values are in the `.dark` block of the same file.

| Role                    | Token (class)                                                                | Light                                                                     | Dark                                               | States                                                                       | Do not use for                                                               |
| ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Primary action          | `--action-primary-bg/-fg/-border` (`bg-primary text-primary-foreground`)     | `#6fd305` fill, `#0f1a02` text (9.4:1), `rgba(58,110,14,.35)` hairline    | same fill and text; hairline `rgba(111,211,5,.4)`  | hover `#5cb300`, press `#55a600`, disabled `#ebebeb` / `#707070`, focus ring | a second button on the same surface, row actions, filters, toggles           |
| Brand mark              | `--brand-mark` (`bg-brand-mark`, `fill-brand-mark`)                          | `#6fd305`                                                                 | `#6fd305`                                          | none                                                                         | text, borders, large surfaces; only the logo, the live pulse, the unread dot |
| Brand text and tint     | `--brand`, `--brand-soft` (`text-brand`, `bg-brand-soft`)                    | `#3a6e0e` on `#f4fce4` (5.8:1)                                            | `#95dd2c` on `rgba(111,211,5,.14)`                 | hover tint `#e7f8c4`                                                         | success, "connected", any feedback state; hover or selected fills            |
| Links                   | `--link/-hover` (`text-link`)                                                | `#3a6e0e` (6.2:1), underlined                                             | `#95dd2c`                                          | hover `#2c5113`, focus ring                                                  | navigation rows, table cells that are not actions                            |
| Keyboard focus          | `--focus-ring` (`ring-ring`)                                                 | `#498c07` (4.2:1 on white), 2px, 1px offset; fields use border + 30% glow | `#6fd305`                                          | shown on `:focus-visible` only                                               | invalid decoration, hover                                                    |
| Checked control         | `--control-checked` (`bg-control-checked`)                                   | `#498c07` track, white thumb                                              | `#6fd305`                                          | disabled checked `#b6e85f`, unchecked `#b8b8b8`                              | badges, buttons                                                              |
| Selected / hover        | `--selected`, `--hover` (`bg-selected`, `bg-hover`)                          | `rgba(0,0,0,.065)` / `rgba(0,0,0,.04)`                                    | `rgba(255,255,255,.10)` / `.06`                    | pressed `rgba(0,0,0,.09)`                                                    | anything green                                                               |
| Success                 | `--success/-fg/-bg` (`text-success-fg bg-success-bg`, `bg-success` for dots) | `#0e6b33` on `#caface` (5.7:1), mark `#15b042`                            | `#7ee3a0` on `rgba(21,176,66,.16)`, mark `#3ccf6b` | badge carries a glyph                                                        | brand emphasis, primary buttons                                              |
| Warning                 | `--warning/-fg/-bg`                                                          | `#8a5a00` on `#fdf1cf` (5.3:1), mark `#e0a106`                            | `#f5cf6b` on `rgba(224,161,6,.16)`                 | badge carries a glyph                                                        | pending or informational states                                              |
| Danger                  | `--danger/-fg/-bg` (`text-danger-fg`, `bg-danger` for destructive buttons)   | `#b91c1c` on `#fbeaea` (5.6:1), mark `#dc2a2a`                            | `#f59a9a` on `rgba(220,42,42,.16)`                 | destructive button `#dc2a2a` / white                                         | form validation copy that is only a hint                                     |
| Info                    | `--info/-fg/-bg`                                                             | `#235fbe` on `#e8f0fd` (5.3:1), mark `#2f6bd4`                            | `#9cc0f5` on `rgba(47,107,212,.18)`                |                                                                              | links, selected states                                                       |
| Pending / neutral state | `--pending/-fg/-bg`                                                          | `#5c5c5c` on `#f4f4f4`                                                    | `#b8b8b8` on `rgba(255,255,255,.08)`               | badge carries a glyph                                                        |                                                                              |

Where the brand cluster is allowed to appear in the console, in full: the
logo mark, the one primary action per surface, the keyboard focus ring,
checked controls, action links, brand lifecycle badges (default key, built-in
resource), and two small live markers (the running pulse, the unread dot).
Everything else is neutral or a feedback colour.

## 5. Application example

`just e2e ui design-contract` captures the Providers, MCP servers,
Environments, Runs, and Settings surfaces with sanitized fixture data; the
before/after pairs are in
[console-design-contract.md, section 9](./console-design-contract.md#9-evidence).
On one screen the hierarchy is: brand mark (top left), one green action
("Create environment"), neutral selected navigation row, neutral hover and
selected rows, feedback badges in their own hues ("Authorized" success,
"Disabled" pending, "Limited network" warm neutral), and a green ring only
when the keyboard is in use. The dark variant of the same page is captured
from the `.dark` token block
([providers-dark-1440x900.png](./assets/contract/after/providers-dark-1440x900.png)).

## 6. Contrast and non-colour cues

Contrast ratios above were computed from the token values (WCAG relative
luminance) and are enforced by
`apps/web/tests/console-design-contract-boundary.test.ts`; the browser case
recomputes the badge and button ratios on the rendered page. Every state is
also distinguishable without colour: badges carry glyphs (check, power-off,
star), invalid fields carry a message with `role="alert"`, disabled controls
change surface and text rather than fading, focus is a ring rather than a
colour change, and the working state animates.

## 7. Rejected options

- Black primary buttons (the shipped console before this change, and
  Mintlify's product shell): kept the brand almost invisible inside the
  product; the Supabase model puts the colour where the user acts.
- Brand-cast neutrals (Mintlify's `#485450`): a faint green in every grey is
  hard to keep consistent across tints and dark mode; Mosoo's neutrals are
  pure.
- Brand green as the success colour: "connected" and "the action" would share
  one hue; success is a separate true green.
- Blue checked controls (`#0077e6` from the #599 cheatsheet): a second hue
  with no meaning in the product; checked controls use the deep brand tone.
