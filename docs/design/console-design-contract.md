# Console design contract

The visual rules for the mosoo web console (`apps/web`). Values live in code:
tokens in [`app.css`](../../apps/web/src/shared/styles/app.css), measurements
in the recipes under [`shared/ui`](../../apps/web/src/shared/ui/), and the
gate (section 11) checks what can be checked. This page keeps the rules
and the reasons code cannot carry; what the product is lives in
[SPEC](../SPEC.md).

The console serves technical people in the middle of a configuration or
monitoring task, so it should feel native to users of GitHub, Linear and
Vercel: precise, restrained, neutral first, with the brand green as
punctuation. It is not a marketing template with hero metrics, not a
chrome-heavy dashboard with modal-first flows, and not an over-rounded,
glassy, shadow-heavy "AI startup" kit. Where this page is silent, copy the
nearest surface built from the recipes (the sidebar, the Overview, Providers,
the MCP servers, Environments, Runs and Agents lists, and the settings pages)
instead of inventing a pattern. Older surfaces still show patterns this page
retires, such as hand-built rows, chips and status pills; they are debt, not
precedent: do not copy them, and bring what a change touches onto these rules.

## 1. Layers and ownership

Route code composes the recipes in `shared/ui`. A shape no recipe covers is
built from the same tokens and the nearest recipe's measurements, and a shape
that a second surface needs moves into `shared/ui`. Recipes consume the
semantic classes that `app.css` bridges to Tailwind (`text-fg-2`,
`bg-selected`, `bg-primary`) and use a bridged primitive (`bg-paper-300`) only
where no semantic role fits. Never use a raw colour: a hex value, an
arbitrary colour class, or a Tailwind palette class such as `bg-white` where a
role exists (`bg-card`), because it bypasses the role and the next change to
the role misses it. White stays literal only where it must stay white on any
surface: the switch thumb and text on a solid danger fill. Fixed colours
belong only to art that expresses no mosoo state: third-party brand marks,
the MCP and user avatar palettes, the login illustration. A raw value in
route code needs a sentence in the PR.

The console ships one theme, light. Nothing sets the `.dark` class, so design
and review against the light roles, and add no `dark:` utilities: Tailwind's
`dark:` follows the operating system's colour scheme, so it darkens a single
control on a light page. The dark mapping stays ready all the same: every
semantic role is defined in `:root` and again in the `.dark` block, and a new
role gets its dark value in the same change. The pre-contract aliases
(`bg-muted`, `text-muted-foreground`, `bg-accent`, `border-border-subtle`,
`text-destructive`, the `amber`, `ember` and `sky` names) are retired: nothing
bridges them, so such a class renders nothing. Use the role each stood for:
`bg-sunken`, `text-fg-3`, `bg-hover`, `border-border-soft`, `text-danger`, and
`warning`, `danger` and `info`. The gate checks all three rules.

## 2. Colour

### 2.1 Surfaces and fills

Neutrals are pure greys. Content sits on white `--bg-elevated` surfaces
(`bg-card`) over the `--bg` canvas, and `--bg-sunken` holds nested groups,
tinted rows, command blocks and segmented tracks. The sidebar sits one tonal
step below the canvas (`--bg-sidebar`), and the content pane meets it with a
hairline and an inset corner, so the navigation reads as a place rather than
a column. Cards, lists, dialogs and menus take the default hairline, rows
inside them the soft one, and `--border-strong` is only for controls that
must read as controls. Hover, selected and pressed are neutral alpha fills; a
selected navigation row adds weight and `aria-current="page"` to the fill, and
selection is never green: no green fill, border, left bar or check mark. A
selected option card takes the emphasis border on the selected fill
(`border-emphasis bg-selected`).

### 2.2 Text roles

`--fg-heading` carries titles and row names, `--fg-1` text and values, `--fg-2`
descriptions, `--fg-3` captions, group labels and metadata, and `--fg-muted`
placeholders, disabled labels and decorative separators only, because it
clears just 3:1. The quieter tones are alphas of the ink, which is never pure
black, so they keep the cast of the surface below. Hierarchy comes from these
tones and the type roles (section 3), never from glow or a heavier weight than
the role sets.

### 2.3 Brand cluster

One hue, anchored on the logo mark, with one job per token:

- `--action-primary-*` (`bg-primary`, the default Button): the one focal
  action per surface. Never a second button, a row action, a filter or a
  toggle.
- `--focus-ring`: keyboard focus, and the border of an open `Select`.
  `--control-checked`: the checked switch.
- `--link`: text that is an action, underlined (`text-link underline`,
  `hover:text-link-hover`).
- `--brand` on `--brand-soft` (the `brand` Badge): markers with a
  mosoo-specific meaning, such as the default key and the default
  environment.
- `--brand-mark` (the logo's green): small live markers (the working pulse,
  the unread dot, a loading spinner); never text, borders or large surfaces.

That list, plus the pale text-selection highlight (`--green-100`), is the
complete set of places the green appears: selection, hover, backgrounds,
feedback badges and second buttons are never green. The strong neutral is
`--emphasis` (near-black): tooltips, the border of a selected option card, and
the sidebar's Create agent, which keeps the sidebar from adding a second green
action to every screen.

### 2.4 Status roles

Success, warning, danger, info, pending and soil are feedback colours, never
brand. Each has a mark, a tint, and a text tone that clears 4.5:1 on that
tint. Success is a separate true green, so "connected" never looks like "the
action". A solid danger fill is only for destructive buttons, and an
irreversible action sits behind a confirm dialog. Soil marks restrictions
such as a limited network. A status that stands alone carries a glyph or a
label, not colour alone: a check for success, the alert triangle for a
warning, the x-circle for a failure, power-off or a dashed circle for
disabled and archived, and a star for a default. A status that a word
already states ("Ready", "Needs key", "Draft") stays that word, without a
status light beside it.

## 3. Typography

Two self-hosted families: Geist for every sans role, page titles included,
and Geist Mono for precise information. Never add a web font to a fallback
stack: the browser downloads the next face in a stack as soon as text holds a
code point the earlier faces lack, so a fallback costs bytes even when it
draws nothing. CJK text renders in the platform sans and never pulls a web
font: `:root:lang(zh)` names the Chinese face for each OS, and Japanese falls
through the system faces of the default stack.

| Role                | Size / line / weight                         | Where                                        |
| ------------------- | -------------------------------------------- | -------------------------------------------- |
| Page title          | 24 / 28 / 500, 22px on narrow screens        | `PageHeader` (`t-page-title`)                |
| Dialog title        | 16 / 20 / 600 (500 for empty-state titles)   | `DialogTitle`, `EmptyState`                  |
| Section title       | 15 / 20 / 600                                | card titles (`t-section-title`)              |
| Body                | 14 / 20 / 400                                | running text (the page default)              |
| Control text        | 13 / 20 / 400                                | field values, rows, menu items, descriptions |
| Label               | 13 / 500                                     | `Label`, buttons, sidebar rows, row names    |
| Caption             | 12 / 16 / 400; table headers 500 in `--fg-2` | helper text, metadata, `Table` headers       |
| Group label         | 12 / 16 / 500, sentence case                 | sidebar and settings (`t-group-label`)       |
| Precise information | Geist Mono, tabular numerals                 | ids, keys, model ids, durations (`MonoText`) |

Use weights 400, 500 and 600. A heading differs by size, weight, tracking and
tone, never by a second face. Tracking tightens only on titles
(`tracking-title` on page titles, `tracking-subtitle` from 15 to 20px); body,
labels, controls and group labels carry none. Sizes are fixed, never fluid,
and line heights land on the 4px grid. Do not set text in tracked capitals or
put a kicker above a heading. Mono is for short precise strings, never for
descriptions or forms.

## 4. Component recipes and states

Build screens from the shared recipes, so buttons, forms, rows and empty
states read the same everywhere:

| Job                                  | Recipe                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Page title, description, actions     | `PageHeader`; `meta` holds an id badge or a status beside the title                         |
| Search, filters and list content     | `ListPageToolbar`, `ListPageSearch`, `ListPageContent`                                      |
| The surface's one focal action       | `Button` (default variant)                                                                  |
| Every other action                   | `Button` `outline`; `ghost` for quiet and icon-only actions; `destructive` behind a confirm |
| Records in a list                    | `DataRow` inside `RowList`                                                                  |
| Credentials and integrations         | `ConnectionRow`, `tone="tinted"` inside a card                                              |
| Columns of data                      | `Table`                                                                                     |
| A status or lifecycle tag            | `Badge` with a status variant, or `brand`                                                   |
| Ids, keys, model ids, durations      | `MonoText`; a command to copy is a `CommandBlock`                                           |
| Fields                               | `Label` with `Input`, `Textarea` or `Select`; `Switch` for an on/off setting                |
| List or grid view                    | `ViewToggle` (a radio group on the sunken track)                                            |
| One of a few text options            | `SegmentedControl` (the same track with text segments)                                      |
| Menus, dialogs, side panels, tooltip | `DropdownMenu`, `Dialog`, `Sheet`, `Tooltip`                                                |
| Nothing to show yet                  | `EmptyState`: an icon, a title, one sentence and one primary action                         |

Controls are 32px tall by default: `sm` (28px) for row actions, `xs` (24px)
inline, and an icon-only button matches the height of its neighbours. Rows
are minimum heights (40px for data, 44px for connections) that grow by whole
lines. Information cards have no recipe: `rounded-lg border border-border
bg-card p-6`, flat.

A list row shows the name, the attributes that differ between rows and the
status as a word or a badge; ids and other detail belong in the detail view,
where an id is a copyable badge. Filters sit in one wrapping toolbar row after
the search box, without labels above them, and are disabled only when their
options fail to load. Text that can grow (names, titles, paths) truncates
inside its own cluster (`min-w-0`, `truncate`, the full text in `title`)
before it reaches the next control, and controls stay in the layout flow
rather than positioned over variable text. Nothing is decorative: a dot, a
gradient, a badge or an animation must tell the user something the text does
not.

Design every state that applies: rest, hover, pressed and keyboard focus,
crossed with disabled, read-only, loading, invalid, selected and open.

- Focus is the same 2px `--focus-ring` ring everywhere, independent of
  invalid styling; fields turn their border to the focus tone with a soft
  glow instead.
- Disabled and read-only change the surface and the text, never the opacity
  of the whole control, and keep the label.
- Invalid is `aria-invalid` on the field, which turns its border to danger,
  plus a `role="alert"` message.
- Loading sets `aria-busy` and swaps the leading glyph for a spinner without
  changing the width.
- Selected, connected, warning, dangerous and pending states carry a glyph, a
  label or a position as well as a colour.
- Icon-only controls carry `aria-label`; a single-choice toggle is a radio
  group.

## 5. Radius and elevation

Cards are work surfaces, not pillows. Surfaces and controls 32px and taller
use the 6px corner, nested elements (rows inside a card, badges, menu items,
smaller controls) 4px, and tags and kbd 2px. A child is never rounder than
its parent, and only pills round past 6px. Information cards and dialogs pad
24px. Resting surfaces are flat: shadows belong to floating layers (menus,
popovers, dialogs, the sheet) and to the checked segment of a segmented
control, and the focus ring is the only shadow a field or button carries.

## 6. Icons

General glyphs are Hugeicons Free, wrapped by `createHugeicon` from
`shared/ui/icons.tsx` (`currentColor`, 1.5 stroke), 16px inline and 20px in
empty states. Routes import its semantic exports, so changing a glyph is a
one-file edit; a shell file may register a glyph next to the surface that
owns it. Add or remove a glyph in [`registry/icons.yml`](./registry/icons.yml)
in the same change; the gate fails when the registry and the Hugeicons
registrations disagree.
Purpose-built art never stands in for a general glyph: the product marks, the
sidebar family, vendor and runtime marks, MCP server avatars, the working
pulse and the login illustration. Marks that own a brand colour keep it, and
vendor and runtime marks sit in a neutral tile. No emoji and no second
general icon library. The same rule is the shared icon contract with Mosoo
Computer, which keeps its own adapter.

## 7. Motion

Motion only communicates a state change. Controls transition just the
properties that change, at 150ms ease-out, and overlays fade in with a zoom
(the sheet slides instead). No `transition-all` and no press-scale.
`prefers-reduced-motion` turns off the shared controls' transitions and the
console's own animations in `app.css` (the success check falls back to a
fade).

## 8. Accessibility

The target is WCAG AA: text roles clear 4.5:1 on every light surface (muted
text 3:1), badge text clears 4.5:1 on its tint, and the focus ring and the
checked track clear 3:1 on white. Every state has a non-colour cue
(section 4), every control works from the keyboard, and the mobile drawer
raises its rows to 44px touch targets.

## 9. Sidebar

`navigation.tsx` and `app-shell.tsx` split the column into three zones: a
fixed header line (the identity row and the collapse toggle); a scrolling
work list (Create agent; Overview, Runs, Agents, Files; Resources); and an
anchored footer (Project settings, Help & docs, Language, the account card)
that stays reachable however long the list grows. Spacing, not a rule,
separates the zones; a hairline under the header appears only once the work
list has scrolled. The Project and Org sidebars share one width, and the
Project sidebar collapses to an icon rail (`SIDEBAR_WIDTH_CLASS` and
`SIDEBAR_RAIL_WIDTH_CLASS` in `app-shell.tsx`).

- The identity row is the brand tile, the Project name and a chevron hugging
  the name, without a border, so it reads as a title with a disclosure. Its
  menu switches Projects and holds "Back to {org}"; in the rail the tile
  alone is the trigger.
- Create agent is the only filled control, black through `--sidebar-cta-*`
  rather than `--primary`: a green fill in the persistent sidebar would put
  two green actions on every screen. Without a Project it keeps its label on
  a muted fill.
- The account card (avatar, name, email, chevron) is the one bordered surface
  in the sidebar; its menu holds only Account settings and Sign out.
- Navigation rows, the Help link, the Language menu and the drawer share one
  row recipe (`SidebarRow`, `sidebarRowClassName`), and group labels
  (`SidebarSectionLabel`) are sentence case. Selection is a neutral fill, a
  heavier weight and `aria-current="page"`; of the row states only the focus
  ring is green, so "where am I" and "what has focus" never look alike.
  Disabled rows keep their label in the muted tone.
- The group is "Resources", not "Tools": an Agent's tools (MCP tools and
  skills) already own that word. "Project settings" and "Account settings"
  stay distinct in every locale.
- The collapsed rail names rows by `aria-label` and tooltip, so each work row
  needs a glyph that reads alone. The eight work rows share one original
  family in
  [`sidebar-icons.tsx`](../../apps/web/src/shared/ui/sidebar-icons.tsx): a
  24-unit grid, a 1.5 stroke with round caps and joins, one plane of
  `currentColor` at 12% opacity and no other colour, so the row decides every
  state. The footer's utility rows keep Hugeicons.
  [`assets/sidebar-icons/`](./assets/sidebar-icons/) holds standalone SVG
  copies of the same paths for Mosoo Computer: change both in the same PR.
- The Org layer keeps a horizontal header, which marks the account layer, but
  shares the sidebar surface, the rows and the footer. The mobile drawer
  opens from the left with the identity row at its head.

## 10. Copy

- Sentence case for every string, buttons, tabs, group labels and table
  headers included: "Create agent", not "Create Agent". Proper nouns and
  acronyms keep their capitals, but the brand on its own is "mosoo",
  lowercase, even at the start of a sentence.
- Buttons are a verb plus an object: "Save changes".
- Name the concrete thing the product does. No marketing buzzwords, no
  staccato slogans, no em dashes.
- Every visible string comes from the four locale catalogs; a raw key on
  screen is a bug. Read each label in context in every locale; two rows that
  share a word are resolved, not tolerated.

## 11. Gate

[`console-design-contract-boundary.test.ts`](../../apps/web/tests/console-design-contract-boundary.test.ts)
and
[`sidebar-hierarchy-boundary.test.ts`](../../apps/web/tests/sidebar-hierarchy-boundary.test.ts)
check the rules that can be read from source and run in `just test`, which is
the only part of this gate that CI runs. The fixture-backed browser cases
[`design-contract.spec.ts`](../../e2e/cases/ui/design-contract.spec.ts) and
[`sidebar.spec.ts`](../../e2e/cases/ui/sidebar.spec.ts) measure the rendered
console and write screenshots to `.tmp/e2e/`; run them through `just e2e`.
Those screenshots are the reference for the current look; the captures
reviewed when these rules were set stay in git history
(`git show 93125f606a:docs/design/assets/<path>`). A UI change attaches its
screenshots, in every state that applies, to the Design section of the
[pull request template](../../.github/PULL_REQUEST_TEMPLATE.md).
