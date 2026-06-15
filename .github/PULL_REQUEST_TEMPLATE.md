Skip inapplicable sections. Fill Summary, Why, Verification, and Required Checks. External contributors may mark repository-maintainer-only items as N/A.

**Ship PR only:** base `main` (or `release/*`); branch `type/scope-subject` (no tool/agent prefixes). See `CONTRIBUTING.md` → _Pull Requests_.

First-time human contributors may be asked by CLA Assistant to sign `CLA.md`. If prompted, reply in the PR conversation with exactly: `I have read the CLA Document and I hereby sign the CLA`. Do not paste the signature into this PR description.

## Summary

-

## Why

-

## Verification

- Commands (`just check`, `just test-file <path>`, `just graphql-codegen`, etc.):
- Manual steps:

## Risk And Blast Radius

- Affected packages:
- Affected user flows or APIs:
- Rollback:

## Evidence

- UI/UX: before/after screenshots for visible changes. Local login via the `@mosoo.ai` development login channel at `http://localhost:5173`.
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
- [ ] Branch follows `type/scope-subject` when maintained in this repository; fork branch names may vary
- [ ] Commits: `type(scope): subject`, English only
- [ ] CLA: if prompted by CLA Assistant, every human contributor has signed by posting the exact required PR comment
- [ ] Self-assigned, or maintainer assigned for external contributors
- [ ] Diff scoped; no unrelated cleanup
- [ ] UI/UX: screenshots in Evidence, or N/A
- [ ] Generated files, codegen, DB baseline, lockfile only when required; none hand-edited

## Generated Files, Schema, And Lockfile

- N/A, or list touched artifacts:
- GraphQL codegen (`just graphql-codegen`):
- DB baseline (`just db-regen`):
- Lockfile (`bun.lock`):
- Confirm no hand-edits to generated paths (`schema.generated.graphql`, `apps/web/src/gql/**`, `pkgs/db/drizzle/**`):
