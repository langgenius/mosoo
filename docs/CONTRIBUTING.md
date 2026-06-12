# Mosoo Contributing Guide

Mosoo is still in alpha exploration, and the repository moves quickly. This document only describes the development and contribution flow that is currently real and usable in this repository, avoiding stale instructions inherited from older versions.

## Before You Start

Before changing code, read the relevant product and architecture documents:

- PRD index: [dev/prd/README.md](../dev/prd/README.md)
- Architecture design: [dev/architecture.md](../dev/architecture.md)

These documents define system boundaries, module relationships, and design intent. If the PRD, architecture, and implementation disagree, fix the source of truth instead of hiding the mismatch in generated files, local adapters, or temporary branches.

When a change pivots a core noun or ownership boundary, update the documentation anchor first: README, roadmap, architecture, PRD index, and the active boundary PRD. For the current Project/App pivot, [Project / App Boundary](../dev/prd/project-app-boundary.md) is the construction lock that resolves older Organization-owned, member-governance, Workspace, and Agent-first wording.

## Repository Structure

This repository is a monorepo:

| Path             | Description                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`       | Cloudflare Worker API with GraphQL, auth, sessions, channels, runtime control plane, and D1/R2/DO bindings.                     |
| `apps/web`       | React web app built with Vite Plus and deployed as Cloudflare Worker assets.                                                    |
| `apps/driver`    | Agent runtime driver bundle used by API Worker / Sandbox paths.                                                                 |
| `pkgs/contracts` | Cross-boundary TypeScript contracts and parser surfaces; cross app / package DTOs should go here first.                         |
| `pkgs/db`        | Drizzle schema and the current generated baseline migration.                                                                    |
| `pkgs/*`         | Runtime-neutral shared packages for events, policy, package format, observability, dev auth, effects, and related capabilities. |
| `e2e`            | Playwright local acceptance scripts and runtime signal contract checks.                                                         |
| `dev/prd`        | Product contracts and writing standards.                                                                                        |

The following generated files must not be edited by hand:

- `apps/api/src/adapters/graphql/schema.generated.graphql`
- `apps/web/src/gql/**`
- `pkgs/db/drizzle/**`

If generated output is wrong, fix the schema, contract, resolver, or PRD source that produced it.

## Toolchain

Required tools:

- `bun >= 1.4.0-canary.1` with text `bun.lock` `lockfileVersion: 2` support.
- `just >= 1.51`
- Vite Plus `vp`: `curl -fsSL https://vite.plus | bash`

The repository already pins Vite Plus and Git hook tooling dependencies. Daily commands should use the global `vp` entry point; scripts that need a stable local entry point should use `node_modules/.bin/vp`.

Command conventions:

- Use `vp run ...` for task orchestration.
- Use `vp exec ...` for local tooling.
- Use `vp exec bun ...` when Bun runtime is required.
- Bootstrap dependencies with `bun install --frozen-lockfile` before repository dependencies are installed.
- Install Git hooks with `vp exec prek -c dev/config/prek.toml install` after `bun install`, so the hook installer comes from the repository dependency graph instead of a one-off `dlx` execution.

## Initialization

Run this from the repository root:

```bash
git submodule update --init   # populate .skills/mosoo-skills (clone with --recurse-submodules to skip this)
bun install --frozen-lockfile
vp run env:init
vp exec prek -c dev/config/prek.toml install
vp run db:migrate:local
```

`vp run env:init` creates or completes `apps/api/.dev.vars`:

- `VAULT_ROOT_SECRET`, `BETTER_AUTH_SECRET`, and `RUNTIME_ACTION_TOKEN_SECRET` are generated as local random values.
- Existing real values are not overwritten; placeholder values copied from `apps/api/.dev.vars.example` are replaced with random values.
- `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are only needed when testing Google login and can be filled manually after the script runs.
- R2 / Cloudflare account variables are only needed for remote storage paths or Cloudflare resources close to production, and can be filled manually as needed.

Local OTP email is emitted as local `.eml` files through Cloudflare Email Workers behavior in Wrangler dev. Production email requires Cloudflare Email Routing and `AUTH_EMAIL_FROM`.

## Agent Skills

Reusable coding-agent skills live in the [`langgenius/mosoo-skills`](https://github.com/langgenius/mosoo-skills) repository, vendored here as a Git submodule at `.skills/mosoo-skills` and exposed through the `.claude/skills` symlink so any agent working in this repo discovers them automatically.

- The skills become available after `git submodule update --init` (or cloning with `--recurse-submodules`). Without it, `.claude/skills` points at an empty submodule directory.
- To bump to the latest skills: `git submodule update --remote .skills/mosoo-skills`, then commit the updated submodule pointer.
- Do not edit skills under `.skills/mosoo-skills` here — they are owned upstream in `mosoo-skills`.

## Local Development

Start the regular local stack:

```bash
just dev
```

This command runs local D1 migration first, then starts the driver build, API Worker, and web app.

Default local URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:8787`

Local login:

- Regular email login uses OTP.
- Under loopback origins, email addresses ending with `@mosoo.ai` use the local development login channel and skip OTP.

Local development notes:

- D1 migration is not applied automatically on the first request; run `vp run db:migrate:local` or `vp run db:regen` before starting services.
- Preview MCP development services use ports `5180+`; ports `5173` and `5174` are reserved for local web / dev flow.
- Before asserting port conflicts or performance problems, measure with `lsof`, `curl`, timing, or another reproducible command.

## Common Commands

```bash
vp run env:init          # create or complete apps/api/.dev.vars
vp run dev              # root dev task; just dev calls it after migration
vp run build            # build driver and web
vp run fmt              # format
vp run fmt:check        # check formatting
vp run lint             # generate Cloudflare types, then run lint
vp run tc               # run workspace typecheck
vp run test             # run regular unit tests
vp run check            # fmt:check + lint + tc + test
vp run graphql:codegen  # regenerate GraphQL schema and web gql output
vp run db:regen         # regenerate the Drizzle baseline from the current schema
```

During development, prefer focused commands for faster feedback:

```bash
vp run --filter @mosoo/api tc
vp run --filter @mosoo/web test
vp exec bun test apps/api/tests/session-run-cancel.test.ts
```

## Database And Migrations

During alpha, historical migrations are not maintained. The database policy stays simple:

- The schema source of truth is `pkgs/db/src/schema/**`.
- The current baseline is `pkgs/db/drizzle/**`.
- When schema and database state diverge, do not add compatibility patches for old local data.
- Rebuild the local database state directly.

Common commands:

```bash
vp run db:regen
vp run db:migrate:local
```

If local database state is dirty, delete the corresponding local database and `.wrangler` state directories, then rebuild. Production release follows the same no-history posture: unless the current schema explicitly supports old data, old data is not considered compatible.

## GraphQL Codegen

GraphQL sources of truth are:

- Field and type spec: `apps/api/src/adapters/graphql/graphql-module-specs.ts`
- Runtime resolvers: `apps/api/src/modules/*/graphql/*-graphql.ts`
- API schema entry point: `apps/api/src/adapters/graphql/create-graphql-schema.ts`
- Codegen schema input: `apps/api/src/adapters/graphql/codegen-schema.ts`
- Codegen config: `dev/config/graphql-codegen.ts`
- Web GraphQL documents: `graphql(/* GraphQL */)` in `apps/web/src/**/*.{ts,tsx}`

After changing backend schema, custom scalar mapping, frontend queries, mutations, or fragments, run:

```bash
vp run graphql:codegen
```

If generated output exposes type or field drift, fix the spec, resolver, contract, or PRD source instead of patching generated files.

## Verification Strategy

Choose validation based on risk and blast radius. The project is still alpha, so every small change does not need new tests, but high-risk behavior changes need focused coverage.

Recommended baseline:

- Documentation changes: `vp fmt --check <files>`, plus link / path checks when moving documents.
- TypeScript package changes: the package `tc` and focused unit tests; run root `vp run tc` when cross-contract behavior changes.
- API behavior changes: focused `bun test` files; add `@mosoo/api tc` when types or bindings are involved.
- Web behavior changes: focused web tests and `@mosoo/web tc`; user-visible flows need browser or manual checks.
- GraphQL changes: `vp run graphql:codegen`.
- DB schema changes: `vp run db:regen` and relevant API tests.

E2E entry points:

```bash
vp run e2e:harness-contract
./e2e/run-deterministic.sh
./e2e/run-preview-smoke.sh
./e2e/run-preview-smoke.sh --headed
./e2e/run-preview-latency.sh
```

`run-deterministic.sh` is the local acceptance path without external credentials. `e2e:harness-contract` covers local harness contracts that do not need live credentials. The preview live harness requires a provider key such as `MOSOO_E2E_OPENAI_API_KEY`, `MOSOO_E2E_ANTHROPIC_API_KEY`, or `MOSOO_E2E_PROVIDER_API_KEY`; set `MOSOO_E2E_PROVIDER=openai|anthropic` to choose the public runtime provider. ACP fallback is an internal transport covered by driver fixture and API integration gates.

## Engineering Principles

Keep changes small, direct, and aligned with existing boundaries.

- Prefer existing project patterns over new abstractions.
- Separate pure transformation logic from I/O, framework lifecycle, and platform APIs.
- Put shared contracts, cross-package payloads, and public schemas in shared packages only when they truly cross boundaries.
- Keep app-local types, view models, and implementation details inside their owning module.
- Keep TypeScript strict and do not introduce `any`.
- Prefer semantically clear named types for exported APIs, avoiding complex inline types that pollute interfaces.
- Put platform-specific implementation only at platform boundaries; shared packages must stay runtime-neutral.
- Fail fast for required business values and invariants; avoid broad `try/catch`, silent fallbacks, or placeholder defaults that hide problems.
- Keep one canonical naming or command grammar for each user-facing concept.

Frontend additions:

- Keep existing UI conventions first, then consider new interaction patterns.
- Prefer the generated strongly typed API access layer.
- Do not handwrite a parallel request layer.
- Do not overuse React Context for high-frequency shared state.
- When editing React, do not add `useEffect` unless it is truly synchronizing with an external system.

Data access and performance:

- Design queries explicitly around access paths.
- Prefer `ORDER BY id` for list sorting unless the call site explicitly requires another order.
- Do not hide default filtering or sorting in the ORM layer.
- Avoid N+1 queries in loops; related data must be explicitly preloaded.
- Avoid full `count()` for very large table pagination; prefer cursors or estimates.

## Dependency Policy

Avoid low-value third-party dependencies. Implement small generic logic inside the repository first. For third-party service integrations, prefer lightweight typed API clients written in the repository; introduce an SDK only when it clearly reduces complexity.

## Branch, Commit, Issue, And PR

Branch names, commit messages, and PR titles all follow Conventional Commits semantics.

Commit messages must at least satisfy:

```text
type(scope): subject
```

Examples:

```text
feat(channels): add telegram binding validation
fix(auth): reject invalid local backdoor email
chore(dev): move contribution guide to root
```

Branch names use the same type / scope semantics. Recommended format:

```text
type/scope-subject
```

Examples:

```text
chore/contributing-guide
fix/auth-local-backdoor
chore/dev-docs-layout
```

Use `!` only for intentional breaking changes. Every Issue and PR must be self-assigned. PRs should keep a clear scope, describe verification results, and explicitly state whether they include generated files, GraphQL codegen, or DB baseline updates.

## Deployment Notes

Production deployment scripts exist, but they are not part of the daily contribution flow:

```bash
vp run deploy:api
vp run deploy:web
vp run deploy
```

API production config lives in `apps/api/wrangler.toml`; web production config lives in `apps/web/wrangler.toml`. Cloudflare routes send `mosoo.ai/api/*` to the API Worker and `mosoo.ai/*` to the web Worker.

Do not deploy production directly from an unreviewed local branch.
