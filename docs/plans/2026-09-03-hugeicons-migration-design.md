# Hugeicons migration design

## Decision

Mosoo Console and Mosoo Computer will use Hugeicons for every generic product
interface icon. The two applications keep their own components and build
systems; this is a shared visual contract, not a shared component package.

## Scope

- Replace `lucide-react` imports in `apps/web` with a local Hugeicons adapter.
- Replace `@phosphor-icons/react` imports in Mosoo Computer with its local
  Hugeicons adapter.
- Keep product marks, provider/channel logos, favicons, illustrations, and
  runtime-generated SVG as assets rather than reclassifying them as UI icons.
- Preserve each use site's accessible name, tooltip, disabled state, keyboard
  behavior, loading behavior, and layout dimensions.

## Contract

Both adapters render `@hugeicons/react` with the free icon set and default to
`currentColor` with a 1.5px stroke. Call sites use semantic aliases so that a
future brand glyph change is localized to the adapter instead of spread across
product routes.

## Acceptance and release

There must be no production source import from Lucide or Phosphor after the
migration. Each repository must pass its typecheck, tests, and production build
before its PR is merged. Console production uses the web-only deployment path
because this visual-only change must not deploy the API or touch D1; Computer
uses its existing Worker deployment path. After each deployment, smoke-test the
public application and the affected console shell.
