# Console typography audit

Date: 2026-09-09. Scope: the Mosoo Console (`apps/web`). Baseline: `main` at
`878535439b` (Console design contract 1.0). Outcome: contract 1.1, recorded in
[console-design-contract.md](./console-design-contract.md) sections 2.2, 3, 4,
5, 10 and 11, and in `apps/web/DESIGN.md`.

The question was whether the console ships too many fonts. It did: five
families in seven `@font-face` blocks, 963 KB of binaries, and 457 KB fetched
on every page, of which 352 KB (Inter) never rendered a glyph. The console now
ships two families, Geist and Geist Mono, 100 KB in two files, and every sans
role including page titles is carried by size, weight, tracking, and text tone
rather than by a change of face. The same pass re-cut the text tones, tracking,
radius ladder, and elevation to the owner's rules (section 6).

## 1. Method

Everything below was measured, not read off the stylesheet:

- Shipped files: `fontTools` over `apps/web/public/fonts` (bytes, glyphs, code
  points per Unicode block, variable axes, metrics).
- Fetched files: a Playwright probe over the dev server that installs the
  console fixtures (`e2e/lib/console-fixtures.ts`), opens Providers, Runs, and
  Environments in `en` and `zh-CN` in a cold browser context, records every
  `font` response with its body length, and asks CDP
  (`CSS.getPlatformFontsForNode`) which platform font actually drew the title,
  the description, a sidebar label, an id, and a section title. The baseline
  run used the untouched checkout (the change stashed); the after run used
  this branch. `Network.responseReceived` confirmed one response per file
  after the change (the preload and the stylesheet share one request).
- Rendered surfaces: `just e2e ui design-contract` (before and after) and
  `just e2e ui typography-proof`, which also writes `font-requests.json` next
  to its PNGs.
- Contrast: the WCAG formula over composited colours, in
  `apps/web/tests/console-design-contract-boundary.test.ts` and a scratch
  table for the candidate alphas.

The typography rules applied come from the skills named in section 3; the
Vercel Web Interface Guidelines were fetched from their source and the
relevant lines quoted there.

## 2. Inventory at the baseline (`878535439b`)

| Family          | File(s)                                          | Bytes            | Glyphs / code points | Coverage                                       | Declared role                                     | Consumers                                                                  |
| --------------- | ------------------------------------------------ | ---------------- | -------------------- | ---------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| Geist           | `Geist-Variable.woff2` (wght 100-900)            | 29,288           | 288 / 225            | Basic Latin, Latin-1, a few punctuation marks  | `--font-sans` first                               | every UI string                                                            |
| Inter           | `InterVariable.woff2`, `InterVariable-Italic.woff2` (opsz, wght) | 352,240 + 387,976 | 2,937 / 2,852 each | Latin Extended, Greek, Cyrillic, symbols       | `--font-sans` second, `--font-heading` third      | nothing rendered in it (measured)                                          |
| Instrument Sans | `InstrumentSans-Variable.woff2` (wght 400-700)   | 30,092           | 244 / 208            | Basic Latin, most of Latin-1                   | `--font-heading` first                            | `page-header.tsx`, `empty-state.tsx`, the Org header in `app-shell.tsx`    |
| IBM Plex Mono   | `IBMPlexMono-Regular.woff2`, `IBMPlexMono-Medium.woff2` | 45,640 + 46,724 | 1,125 / 983 each   | Latin Extended, Cyrillic, box drawing          | `--font-mono` first                               | 42 files through `font-mono` and `MonoText`; the Medium file never fetched |
| Geist Mono      | `GeistMono-Variable.woff2` (wght 100-900)        | 71,136           | 1,157 / 887          | Latin Extended, some Cyrillic, box drawing     | `--font-mono` second                              | nothing rendered in it                                                     |

Total binaries 963,096 bytes plus four licence files. No file covers CJK; the
xterm terminal (`routes/agent/components/terminal-mode.tsx`) sets its own
`ui-monospace` stack and loads no web font, which is right for it: xterm
measures its cell grid when the terminal is created, and a web font that
arrives later misaligns the grid.

### What a page actually fetched

| Page, locale             | Before: files                                                        | Before: bytes | After: files               | After: bytes |
| ------------------------ | -------------------------------------------------------------------- | ------------- | -------------------------- | ------------ |
| Providers, `en`          | Geist, Instrument Sans, IBM Plex Mono Regular, Inter                 | 457,260       | Geist, Geist Mono          | 100,424      |
| Providers, `zh-CN`       | same four                                                            | 457,260       | Geist, Geist Mono          | 100,424      |
| Runs, `en` and `zh-CN`   | same four                                                            | 457,260       | Geist, Geist Mono          | 100,424      |
| Environments, `en` and `zh-CN` | same four                                                      | 457,260       | Geist, Geist Mono          | 100,424      |

Per cold load the change removes 356,836 bytes (78%). Shipped binaries go from
963,096 to 100,424 bytes (90% less).

What rendered what (CDP platform fonts, Providers):

| Element        | Before, `en`                | After, `en`      | Before, `zh-CN`                   | After, `zh-CN`                    |
| -------------- | --------------------------- | ---------------- | --------------------------------- | --------------------------------- |
| Page title     | Instrument Sans (9 glyphs)  | Geist (9)        | PingFang SC, local (5)            | PingFang SC, local (5)            |
| Description    | Geist (64)                  | Geist (64)       | PingFang SC (17)                  | PingFang SC (17)                  |
| Sidebar label  | Geist (12)                  | Geist (12)       | PingFang SC (5)                   | PingFang SC (5)                   |
| Masked key     | IBM Plex Mono (12)          | Geist Mono (12)  | IBM Plex Mono (12)                | Geist Mono (12)                   |
| Section title  | Geist (20)                  | Geist (20)       | PingFang SC (6)                   | PingFang SC (6)                   |

Inter was fetched on every page in both locales and drew nothing. Chromium
downloads the next face in a `font-family` list as soon as a text run contains
a code point the earlier faces lack, before it knows whether the candidate has
the glyph either; with Geist's 225-code-point subset first, the probe shows
that at least one such run exists on every console page in both locales (the
`zh-CN` pages trivially; which English glyph falls through was not isolated),
so the 352 KB fallback was paid for on every load. A fallback in the stack is
not free: "declared only as a fallback" is not the same as unused.

## 3. Rules applied

Read from the local skill clones; the Vercel guidelines fetched from
`vercel-labs/web-interface-guidelines`.

| Source                                                | Rule used                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| impeccable `typeset`                                  | Operate mode: "a single well-tuned family and fixed role scale are often right"; ask whether every family is necessary; "load only used font assets and weights. Provide metric-compatible fallbacks"; never "introduce a second family without a clear role it alone can perform"; hierarchy from size, weight, space, and tone together |
| impeccable `craft-floor`, `operate`                   | tracking floor -0.04em; no kicker or eyebrow above a heading; monospace only for code, data, and measurement; product UI uses a tight scale ratio and familiar sans defaults, never display faces in labels                                                                                                                              |
| impeccable `audit`                                    | measurable findings with severity and location; keep detector output apart from judgement (its "overused font" warning fired on every face present, Inter, Geist, Geist Mono and Instrument Sans alike; the brief pins Geist, and the skill says the brief wins)                                                                          |
| minimalist-ui                                         | Inter, Roboto, Open Sans banned as defaults; a sans with character for body and UI (it names Geist Sans) and Geist Mono for code and metadata; body text never absolute black, secondary text a muted grey (its editorial serif is for landing-page heroes, which design-taste-frontend rules out for dashboards)                        |
| design-taste-frontend                                 | avoid Inter as the default; the named pairing "Geist + Geist Mono"; emphasis stays inside one family, "mixed-family emphasis is amateur"; "control hierarchy with weight + color, not raw scale"; on a redesign, audit first and treat typography as the first lever                                                                      |
| redesign-existing-projects                            | the typography checklist: no Inter everywhere, more than two weights, tabular figures for numbers, negative tracking on large headings, sentence case instead of all-caps subheaders; font swap first, small reviewable changes, work with the existing stack                                                                              |
| brandkit (typography direction only)                  | developer tooling reads as "precise, sharp, confident, builder-native" with monospace accents; one primary and one secondary type pairing; "quieter, sharper, and more intentional"                                                                                                                                                       |
| Vercel Web Interface Guidelines                       | `font-variant-numeric: tabular-nums` for number columns; `text-wrap: balance` on headings; "Critical fonts: `<link rel="preload" as="font">` with `font-display: swap`"                                                                                                                                                                  |

Distilled for a dense B2B console: one sans and one mono; three weights (400,
500, 600); a fixed role scale whose line heights land on the 4px grid;
headings distinguished by size, weight, tracking, and tone, never by a family
swap or a heavier weight; tracking that tightens as size grows and stays at 0
in body and controls; uppercase only for group labels, never as a kicker over
a heading; tabular numerals for ids and numbers; ship only what renders, with
a metric-compatible fallback and a preload.

## 4. Findings

| #   | Severity | Finding                                                                                                                                                                                                                                 | Evidence                                                              |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| F1  | P1       | Inter (352 KB) fetched on every page in both locales, rendering nothing                                                                                                                                                                 | section 2 tables                                                      |
| F2  | P2       | Instrument Sans is a third family for one role; at 24px / 500 its delta from Geist needs a 2x specimen to see, so it fails the "role only it can perform" test while costing a request on every page                                    | `assets/typography/*/specimen-title-2x.png`                           |
| F3  | P2       | Two mono families for one role: IBM Plex Mono first, Geist Mono shipped as its fallback; the Plex Medium weight was never fetched                                                                                                        | section 2                                                             |
| F4  | P2       | No metric-compatible fallback and no preload, so a first paint in the system sans reflowed when Geist arrived                                                                                                                           | `app.css`, `index.html` at the baseline                               |
| F5  | P3       | Geist ships as a Latin-1 subset (225 code points); any other glyph pulled Inter                                                                                                                                                         | fontTools coverage                                                    |
| F6  | P2       | Kickers and uppercase drift: `PageHeader` had an eyebrow slot above the title, the Overview drew "PROJECT" over the project name, and table headers used four different uppercase treatments (11/600/0.06em, 11/800/0.1em, 11/600/0.12em, 10.5/800/0.1em) while the `Table` recipe is 12px / 500 sentence case | `page-header.tsx`, `project-overview.route.tsx`, `agent-table.tsx`, `access-tokens-tab.tsx`, cost panels, `logs-tab.tsx` |
| F7  | P3       | Line heights were unitless ratios that landed off the grid (24px title on 27.6px, 13px labels on 16.9px, 14px body on 20.3px)                                                                                                            | `--lh-*` at the baseline                                              |
| F8  | P2       | Secondary text (`#5c5c5c`, 80% of the ink) sat too close to primary (`#333`) to read as a second level; dark headings were pure `#fff`                                                                                                   | section 6                                                             |
| F9  | P2       | 14 / 10 / 8 / 6 / 4 radii plus `--elev-xs` on resting cards, fields, and buttons read as pillows rather than work surfaces                                                                                                              | `assets/contract/before/providers-1440x900.png`                       |
| F10 | P2       | The Overview header was off-contract: its own kicker, a 24px / 600 title with no tracking, hand-rolled link buttons with a shadow                                                                                                        | `assets/contract/before/*` had no Overview capture; after: `overview-1440x900.png` |

## 5. Decision

Two families. Geist carries every sans role, page titles included; Geist Mono
carries precise information. Inter, Instrument Sans, and IBM Plex Mono are
removed from the stylesheet and from `apps/web/public/fonts` with their
licence files; a `Geist-LICENSE.txt` now sits next to `Geist-Variable.woff2`
(it had none). `index.html` preloads both files. A `Geist Fallback` face maps
local Arial onto Geist's metrics (`size-adjust: 106.28%`,
`ascent-override: 94.56%`, `descent-override: 27.76%`, computed with the
next/font method from both fonts' average advance widths and `hhea` tables)
so the swap does not reflow. `:root:lang(zh)` names the platform CJK sans per
OS (PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC) so the
fallback is the same face everywhere rather than whatever `sans-serif` maps
to; the probe shows PingFang SC drawing every CJK role on macOS with no web
font fetched to find that out.

Why Geist for titles: the previous contract chose Instrument Sans because
"Geist at the same size and weight reads as a larger body line". Measured
against the rules, the fix for that is not a second face but tracking and
tone: at 24px / 500 with -0.02em (-0.48px) on a 28px line in the heading
tone, the Geist title is a title, and the specimen pair under
`assets/typography/` shows the two faces are otherwise interchangeable at this
size. The tokens `--font-heading` and `--font-mono` keep working;
`--font-heading` now resolves to the sans stack.

Why Geist Mono over IBM Plex Mono: both are SIL OFL and both are good faces.
Geist Mono was shipping anyway as the fallback, is one 71 KB variable file
against 92 KB for two Plex weights, and shares Geist's vertical metrics
(ascent 1005, descent 295 on 1000 units, x-height 530), so a 12.5px id next
to a 13px label sits on the same baseline without an optical fix. Plex's
slab texture, the previous argument, is texture rather than legibility at
12.5px.

### Rejected alternatives

| Alternative                                          | Why not                                                                                                                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep Instrument Sans for titles                      | F2: a third family without a role only it can perform; 30 KB and one request per page for a delta that needs a specimen to see                                                              |
| Keep IBM Plex Mono, drop Geist Mono                  | Viable, but heavier (92 KB for two weights), no shared metrics with the UI face, and it keeps a vendor-mixed pairing where the skills name Geist + Geist Mono                               |
| General Sans (2026-09-08 candidate)                  | Unchanged: the ITF Free Font License forbids redistributing the files through a repository; loading it from Fontshare adds a runtime dependency                                             |
| Ship the full Geist build instead of the subset      | Roughly 40 KB more for Latin Extended and Cyrillic glyphs the console's copy does not use; a stray glyph now falls to the platform sans, which is what the CJK path already does             |
| A dedicated CJK web font                             | Even subsetted it is an order of magnitude larger than everything else combined; the platform sans is measured and adequate                                                                  |
| An editorial serif for titles (minimalist-ui)        | design-taste-frontend: serif "not for dashboards"; the product voice is precise and developer-native                                                                                         |
| Heavier Geist titles (600-800)                       | Already rejected by contract 1.0 ("louder, not more distinct") and by the owner's rule: hierarchy through the grey scale, never through weight inflation                                    |
| A subtle text tone under 70% of the ink              | Fails AA on the `#f4f4f4` sidebar and row tint (0.66 blends to `#757575`, 4.19:1); the third level is carried by size instead                                                               |

## 6. The owner's rules, applied and measured

**Tracking scales with size.** `--track-title: -0.02em` (-0.48px at 24px, the
owner's -0.72px at 36px is the same ratio) on page titles and the onboarding
hero; `--track-subtitle: -0.01em` on 15-20px titles (section titles, dialog
and empty-state titles); body, labels, controls, and the sentence-case group
label at 0 (the owner's review in #619 retired tracked capitals from the
console). Tailwind exposes them as `tracking-title` and `tracking-subtitle`.

**Line height and baseline.** Roles carry explicit line heights on the 4px
grid: title 24/28, section title 15/20, label and body 13-14/20, caption and
group label 12/16. The body ratio is 1.4286 (20px at 14px); the tight, snug,
and normal tokens are 1.1667, 1.3334, and 1.4286 so the same sizes land on the
grid wherever a ratio is inherited. Mono ids inherit the row's line height and
share Geist's vertical metrics, so mixed rows need no nudge.

**Text hierarchy through the grey scale.** Every quieter tone is an alpha of
the primary ink, so it keeps the cast of the surface it sits on:

| Token          | Light                      | on `#fff` | on `#fafafa` | on `#f4f4f4` | Dark                        | on `#1f1f1f` | on `#333333` (card) | on `#0d0d0d` (sidebar) |
| -------------- | -------------------------- | --------- | ------------ | ------------ | --------------------------- | ------------ | ------------------- | ---------------------- |
| `--fg-heading` | `#1f1f1f`                  | 16.5      | 15.8         | 15.0         | `#f5f5f5`                   | 15.1         | 11.6                | 17.8                   |
| `--fg-1`       | `#333333`                  | 12.6      | 12.1         | 11.5         | `#ebebeb`                   | 13.8         | 10.6                | 16.3                   |
| `--fg-2`       | `rgba(51, 51, 51, 0.72)`   | 5.3       | 5.1          | 5.0          | `rgba(235, 235, 235, 0.72)` | 7.8          | 6.3                 | 8.7                    |
| `--fg-3`       | `rgba(51, 51, 51, 0.7)`    | 5.0       | 4.8          | 4.7          | `rgba(235, 235, 235, 0.62)` | 6.1          | 5.1                 | 6.7                    |
| `--fg-muted`   | `rgba(51, 51, 51, 0.56)`   | 3.3       | 3.3          | 3.2          | `rgba(235, 235, 235, 0.45)` | 3.9          | 3.5                 | 4.0                    |

The secondary tone is the owner's 72%. The subtle tone is only two points
under it in light because 0.70 is the AA floor on the `#f4f4f4` tint (every
value below it fails there, see the rejected table), so in light the third
level is carried by size (12px captions, 11px group labels) rather than by a
lighter grey; dark has the headroom for a real 0.62 step. Muted is for
placeholders and disabled labels only (3:1). The gate test composites the
alpha tokens over each surface before taking the ratio, in both themes.

**Cards are work surfaces.** Radius ladder `--r-xs 2`, `--r-sm 4`, `--r-md 6`,
`--r-lg 6`: surfaces (cards, dialogs, menus, popovers, `RowList`) and their
32px controls share the 6px corner; rows inside a card, badges, menu items,
24-28px controls, the dialog close, and the checked segment step down to 4;
tags, kbd, and the tooltip arrow sit at 2. The compact (8) and xl (20) rungs
are gone and nothing rounds past 6 except pills. Information cards pad 24px.
Resting cards, fields, buttons, the switch thumb, the sidebar call to action,
the login card, and the composers carry no shadow; `--elev-md` stays on
menus and popovers, `--elev-lg` on dialogs, `--elev-xl` on the sheet, and
`--elev-xs` on the checked segment. The gate test fails on any `rounded-xl`,
`rounded-compact`, or arbitrary radius above 6px, and on a resting shadow in
a shared recipe.

**Consistency.** The same recipes now hold on the Overview (migrated to
`PageHeader` with the id badge in its new `meta` slot, shared buttons, flat
onboarding card), Providers, Environments, MCP servers, Runs, the Skills empty
state, project and account settings, and the invalid and disabled states;
`e2e/cases/ui/design-contract.spec.ts` captures all of them (two new tests for
the Overview and the empty state) and measures radius, padding, shadow,
title metrics, and the secondary tone on the page.

## 7. Verification

Run in the worktree before the pull request; all passing:

- `bun run fmt`, `bun run fmt:check`
- `bun run docs:check`
- `node_modules/.bin/vp lint apps/web e2e`
- `bun run --filter @mosoo/web tc`
- `(cd e2e && ../node_modules/.bin/vp exec tsc --noEmit)`
- `(cd apps/web && bun test tests)` (249 tests)
- `MOSOO_E2E_DESIGN_LABEL=after MOSOO_E2E_BASE_URL=http://127.0.0.1:5180 e2e/node_modules/.bin/playwright test --config e2e/playwright.config.ts e2e/cases/ui/design-contract.spec.ts` (11 tests)
- `MOSOO_E2E_BASE_URL=http://127.0.0.1:5180 e2e/node_modules/.bin/playwright test --config e2e/playwright.config.ts e2e/cases/ui/typography-proof.spec.ts` (10 tests)

Not verified here: rendering on Windows and Linux (the `zh` stack names Segoe
UI Variable, Microsoft YaHei, and Noto Sans CJK SC, but the probe ran on macOS
Chromium only); `size-adjust` on the fallback face in Safari and Firefox
(supported since Safari 17 and Firefox 92, not measured); the production CDN's
cache headers for the two font files (the probe hit the dev server).
