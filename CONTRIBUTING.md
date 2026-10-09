# mosoo Contributing Guide

## Documentation

Each fact has one home; other docs link to it.

| Doc                                                                                | Holds                                               |
| ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| [docs/SPEC.md](./docs/SPEC.md)                                                     | Product promises and non-goals                      |
| [docs/architecture.md](./docs/architecture.md)                                     | Invariants that span files or repositories          |
| [docs/prd/README.md](./docs/prd/README.md)                                         | User-visible behavior and limits, one note per area |
| [docs/production-deploy-verification.md](./docs/production-deploy-verification.md) | Release, staging, rollback, and incident procedures |
| [docs/design/console-design-contract.md](./docs/design/console-design-contract.md) | Console UI rules                                    |
| [e2e/README.md](./e2e/README.md)                                                   | The Playwright E2E harness                          |
| This guide                                                                         | Development workflow                                |

Read the relevant sections before changing behavior or a module boundary, and update the home doc in the same PR. Docs say only what code cannot: link to code, schemas, `wrangler.toml`, or `just --list` instead of restating them, and name a constant instead of copying its value. Write in the present tense about `main`; dates, decision logs, release status, migration narratives, and planned work belong in issues, PRs, and git history. When a doc and the code disagree, find out which one is wrong and fix it; never hide the mismatch in generated files or local adapters.

## Repository Layout

| Path                | Contents                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/api`          | Cloudflare Worker API: GraphQL, Public Thread API, auth, files, runtime control plane, D1/R2/DO bindings |
| `apps/web`          | React console, served by the Web Worker on `cloud.mosoo.ai`                                              |
| `apps/driver`       | Agent Driver, a submodule (see [Submodules](#submodules))                                                |
| `pkgs/contracts`    | TypeScript contracts shared across apps and packages                                                     |
| `pkgs/db`           | Drizzle schema and the append-only D1 migration chain                                                    |
| `pkgs/*`            | Other runtime-neutral shared packages                                                                    |
| `e2e`               | Playwright E2E harness                                                                                   |
| `config`, `scripts` | Repository tooling: hooks, codegen, lint, commit policy, checks                                          |

## Setup

Install `bun >= 1.4.0-canary.1`, `just`, and a Docker-compatible daemon, then run from the repository root:

```bash
just setup
```

It initializes submodules, installs dependencies, creates `apps/api/.dev.vars` (`just env-init`), installs the Git hooks (`just hooks-install`), and applies local D1 migrations. `just env-init` generates the required local secrets, never overwrites a real value, and leaves the optional keys (Google OAuth, the R2 and Cloudflare account backup credentials, skills.sh) blank. `.dev.vars` and `.env` are git-ignored; keep every credential in them or in your shell, never in a tracked file.

Use `just` for every repository operation; `just --list` describes each recipe. `vp` (Vite Plus) is an implementation detail of package scripts, hooks, and CI.

## Submodules

- `apps/driver` pins [`langgenius/mosoo-agent-driver`](https://github.com/langgenius/mosoo-agent-driver). Change Driver code there, then commit the new pointer here in the same PR as the API change that depends on it.
- `.skills/mosoo-skills` pins [`langgenius/mosoo-skills`](https://github.com/langgenius/mosoo-skills), which coding agents discover through the `.claude/skills` symlink. Change skills upstream, then bump the pointer with `git submodule update --remote .skills/mosoo-skills`.
- Skills are generic references, not project authority. `AGENTS.md`, this guide, the `wrangler.toml` files, pinned dependencies, and `just` recipes take precedence; a skill must not migrate config formats, upgrade dependencies, or bypass `just` unless the task requires it.

## Local Development

`just dev` applies pending local migrations, builds the Driver, and starts the API Worker on `http://localhost:8787` and the console on `http://localhost:5173`, which proxies `/api` to the API.

- Sign in with any `@mosoo.ai` address: the development login, which exists only while the API's `WEB_ORIGIN` is a loopback origin, skips OTP. Other addresses receive their OTP as a local file whose path Wrangler logs.
- On macOS, API dev prefers the OrbStack Docker socket, then Docker Desktop's, over an inherited `DOCKER_HOST`. Set `MOSOO_API_DEV_DOCKER_HOST=unix:///path/to/docker.sock` to choose an engine, or `MOSOO_API_DEV_USE_DEFAULT_DOCKER=1` to keep the inherited host.
- Measure before asserting a port conflict or a performance problem: use `lsof`, `curl`, or timings.
- The public site and blog on `mosoo.ai` live in the separate `langgenius/mosoo-website` repository.

## Generated Files

Never edit generated output by hand (the one exception is the SQL of a new `--custom` migration); fix its source and regenerate in the same PR.

| Output                                                                          | Source                                                                                                                                                                                                          | Regenerate                                                        |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `apps/api/src/adapters/graphql/schema.generated.graphql`, `apps/web/src/gql/**` | `graphql-module-specs.ts` and the type definitions in `schema/`, both in `apps/api/src/adapters/graphql/`; scalar mappings in `config/graphql-codegen.ts`; `graphql(/* GraphQL */)` documents in `apps/web/src` | `just graphql-codegen`                                            |
| `apps/api/openapi/public-api-v*.generated.json`                                 | `apps/api/src/adapters/http/routes/public-api-openapi.ts` and the Public API contracts in `pkgs/contracts/src/http`                                                                                             | `just public-api-openapi`                                         |
| `pkgs/db/drizzle/**`                                                            | `pkgs/db/src/schema/**`                                                                                                                                                                                         | `just db-generate <name>` ([details](#database-and-migrations))   |
| `bun.lock`                                                                      | `package.json` files                                                                                                                                                                                            | `bun install`; commit intentional changes, not install-only churn |

`just check` fails on stale GraphQL or OpenAPI output and on incompatible `/api/v1` changes. The console GraphQL schema is internal: change a field together with its first-party callers. The versioned Public Thread API is the external contract.

## Database And Migrations

The schema source is `pkgs/db/src/schema/**`. The migration chain in `pkgs/db/drizzle` serves local, staging, and production D1.

- The chain is append-only. Once a migration SQL file, snapshot, or journal entry is merged or applied, never modify, delete, rename, or regenerate it. Wrangler records applied migrations by filename, so a rewritten file is silently skipped wherever it already ran, and production drifts.
- After a schema change, run `just db-generate <name>`. For a data-only migration, run `just db-generate <name> --custom` and add the reviewed SQL to the new empty file before merge. Commit the SQL, snapshot, and journal entry together.
- Prove the chain with `just db-reset-local`, which deletes only local Wrangler D1 state and reapplies every migration. `just db-migrate` applies pending migrations to existing local state; `just setup` and `just dev` run it for you.
- Destructive or data-rewrite migrations need explicit approval plus a backup and rollback plan.
- Production D1 is never reset; a production deploy applies only pending migrations. [docs/production-deploy-verification.md](./docs/production-deploy-verification.md) covers migration review and recovery.

## Verification

Match verification to risk; high-risk behavior changes need focused tests.

- Iterate with `just tc-package <package>`, `just test-package <package>`, and `just test-file <path>`.
- Root `just tc` rebuilds the Driver's type declarations first. Run it after changing Driver contracts so consumers never check against stale declarations.
- `just check` is the full gate: formatting, doc links, lint, type check, tests, GraphQL freshness, and the Public API OpenAPI checks. Run it before marking a PR ready; CI runs it on every non-draft PR.
- Check user-visible web changes in a browser. [e2e/README.md](./e2e/README.md) describes the Playwright harness.
- For docs, run `just fmt-check-path <path>` and `just docs-check`. The link check covers files, not `#anchors`, so search for a heading's slug before renaming it.

## Engineering Principles

Keep changes small, direct, and inside existing boundaries.

- Build what a current requirement needs. Prefer existing repository patterns over new abstractions, and add no speculative extension points.
- Separate pure transformation logic from I/O, framework lifecycle, and platform APIs. Platform-specific code lives only at platform boundaries; shared packages stay runtime-neutral.
- Put contracts in shared packages only when they truly cross app or package boundaries; keep app-local types and view models in their owning module.
- Keep TypeScript strict: no `any`, and named types instead of complex inline types on exported APIs.
- Keep each runtime dependency on one public export surface. Do not mix source-only and compiled artifacts on the same import path; build upstream packages before starting consumers that need compiled output.
- Preserve intentional dynamic `import()` boundaries (route splitting, lazy Worker initialization, platform isolation, documented cycle avoidance). A new dynamic import needs a concrete loading or boundary reason.
- Fail fast on required business values and invariants: no broad `try/catch`, silent fallbacks, or placeholder defaults that hide problems.
- Keep one canonical name or command grammar for each user-facing concept.

Frontend:

- Follow existing UI conventions and the console design contract before adding new interaction patterns.
- Use the generated, typed GraphQL client; never handwrite a parallel request layer.
- Avoid React Context for high-frequency shared state. Add `useEffect` only to synchronize with an external system.

Data access:

- Design queries around explicit access paths, and do not hide default filtering or sorting in the ORM layer.
- Sort lists with `ORDER BY id` unless the call site needs another order.
- Avoid N+1 queries; preload related data explicitly.
- Paginate very large tables with cursors or estimates, not a full `count()`.

## Dependency Policy

Avoid low-value third-party dependencies, and implement small generic logic inside the repository first. For third-party services, prefer a lightweight typed API client written in the repository; introduce an SDK only when it clearly reduces complexity.

## Branches, Commits, And Pull Requests

- `main` accepts only squash-merged PRs, so each PR title becomes a commit on `main`. PR titles follow `type(scope): subject` with a required scope and a lower-case subject, and `!` marks only an intentional breaking change. `.github/workflows/pr-title-lint.yml` holds the allowed types and is the only subject check.
- Commit authors, committers, and `Co-authored-by:`/`Signed-off-by:` trailers must identify a real person, not an AI coding tool; `config/commit-policy.ts` holds the rejected patterns. Set `user.name` and `user.email` to your own identity.
- The `commit-msg` hook in `config/prek.toml` (installed by `just setup`; rerun `just hooks-install` after changing the hooks) and `.github/workflows/pr-commits-lint.yml` enforce the identity rule. `just commit-check` checks your branch against `origin/main`.
- Name branches `type/scope-subject`, never with a tool prefix such as `codex/` or `claude/`, and open PRs only against `main` (or `release/*`), never between feature branches.
- Fill in the PR template: the verification you ran (or why you could not), and whether the PR touches generated files, GraphQL, migrations, or `bun.lock`. Mark irrelevant or maintainer-only items N/A.
- CLA Assistant asks first-time contributors to sign [CLA.md](./CLA.md) by posting its exact comment once; do not paste the signature into the PR description.

## Deployment

Production deploys run from a push to `deploy/try` (`.github/workflows/deploy-try.yml` runs `just check`, then `just deploy`) or manually with `just deploy`. `just deploy-api` (the API Worker behind `cloud.mosoo.ai/api/*`) and `just deploy-web` (the console Worker) publish without the gate. `just deploy-stage` publishes to the separate staging environment. Never deploy an unreviewed branch, and follow [docs/production-deploy-verification.md](./docs/production-deploy-verification.md) for every release.
