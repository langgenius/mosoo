Skip inapplicable sections. Fill Summary, Why, Verification, and Required Checks.

## Summary
-

## Why
-

## Verification
- Commands (`vp run check`, focused `bun test`, `vp run graphql:codegen`, etc.):
- Manual steps:

## Risk And Blast Radius
- Affected packages:
- Affected user flows or APIs:
- Rollback:

## Evidence
- UI/UX: before/after screenshots for visible changes. Local login via `@mosoo.ai` development backdoor at `http://localhost:5173`.
- API or behavior:
- Logs, recordings, or test output:

## Compatibility
- Public contract changes:
- Env or config changes:
- Deployment or migration:

## Reviewer Focus
- Closest review areas:
- Known trade-offs:

## Required Checks
- [ ] PR title: `type(scope): subject` (e.g. `fix(fmt): restore pre-commit checks`)
- [ ] Type: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`, `build`, `ci`, `style`, or `revert`
- [ ] Subject starts lowercase; `!` only for intentional breaking changes (e.g. `feat(api)!: remove legacy session field`)
- [ ] Branch: `type/scope-subject` (e.g. `chore/contributing-guide`, `fix/auth-local-backdoor`)
- [ ] Commits: `type(scope): subject`, English only
- [ ] Self-assigned
- [ ] Diff scoped; no unrelated cleanup
- [ ] UI/UX: screenshots in Evidence, or N/A
- [ ] Generated files, codegen, DB baseline, lockfile only when required; none hand-edited

## Generated Files, Schema, And Lockfile
- N/A, or list touched artifacts:
- GraphQL codegen (`vp run graphql:codegen`):
- DB baseline (`vp run db:regen`):
- Lockfile (`bun.lock`):
- Confirm no hand-edits to generated paths (`schema.generated.graphql`, `apps/web/src/gql/**`, `pkgs/db/drizzle/**`):
