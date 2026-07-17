# Mosoo Contributing Guide

Mosoo is still in alpha exploration, and the repository moves quickly. This document only describes the development and contribution flow that is currently real and usable in this repository, avoiding stale instructions inherited from older versions.

## Before You Start

Before changing code, read the relevant product and architecture documents:

- PRD index: [docs/prd/README.md](./docs/prd/README.md)
- Architecture design: [docs/architecture.md](./docs/architecture.md)

These documents define system boundaries, module relationships, and design intent. If the PRD, architecture, and implementation disagree, fix the source of truth instead of hiding the mismatch in generated files, local adapters, or temporary branches.

When a change pivots a core noun or ownership boundary, update the documentation anchors first: README, architecture, PRD index, and the active boundary PRD. The canonical product contract is [docs/SPEC.md](./docs/SPEC.md); [App Boundary](./docs/prd/app-boundary.md) records the current resource and ownership shell around the managed Agent runtime.

## Repository Structure

This repository is a monorepo:

| Path                   | Description                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`             | Cloudflare Worker API with GraphQL, auth, sessions, channels, runtime control plane, and D1/R2/DO bindings.                     |
| `apps/web`             | React console app built with Vite Plus and deployed as Cloudflare Worker assets on `try.mosoo.ai`.                              |
| `apps/driver`          | Agent Driver bundle used by API Worker / Sandbox paths.                                                                         |
| `pkgs/contracts`       | Cross-boundary TypeScript contracts and parser surfaces; cross app / package DTOs should go here first.                         |
| `pkgs/db`              | Drizzle schema and generated D1 migrations (currently one squashed baseline).                                                   |
| `pkgs/*`               | Runtime-neutral shared packages for events, policy, package format, observability, dev auth, effects, and related capabilities. |
| `e2e`                  | Playwright local acceptance scripts and runtime signal contract checks.                                                         |
| `config`               | Shared repository tooling config (prek, GraphQL codegen, TypeScript bases, lint).                                               |
| `scripts`              | Repository automation scripts (commit policy, docs indexes, submodule and codegen checks).                                      |
| `docs/prd`             | Product contracts and their status index.                                                                                       |
| `docs`                 | Canonical spec, architecture, PRD writing standards, and operational runbooks.                                                  |
| `docs/architecture.md` | Stable engineering boundaries and system-level contracts.                                                                       |

The following generated files must not be edited by hand:

- `apps/api/src/adapters/graphql/schema.generated.graphql`
- `apps/web/src/gql/**`
- `pkgs/db/drizzle/**`

If generated output is wrong, fix the schema, contract, resolver, or PRD source that produced it.

Minimum generated-file rules:

- GraphQL schema, scalar mapping, query, mutation, or fragment changes require `just graphql-codegen`.
- DB schema changes require regenerating migrations with `just db-regen`; production constraints on the recorded baseline are described in [Database And Migrations](#database-and-migrations).
- Dependency changes require committing the resulting `bun.lock`; install-only lockfile churn should stay out of the PR.

## Toolchain

Required tools:

- `bun >= 1.4.0-canary.1` with text `bun.lock` `lockfileVersion: 2` support.
- `just >= 1.51`

The repository already pins Vite Plus and Git hook tooling dependencies. Human-facing repository operations use `just`; the `justfile` delegates to `bun run`, which resolves the pinned local Vite Plus binary after `bun install`. A global Vite Plus install is optional for direct shell use: `curl -fsSL https://vite.plus | bash`.

Command conventions:

- Use `just --list` to discover supported human-facing operations.
- Use `just <recipe>` for setup, development, generation, verification, and deployment.
- Treat `vp` commands as implementation details for package scripts, hooks, and CI.
- Use `just setup` to bootstrap dependencies, initialize the environment, install Git hooks, and apply local migrations.

## Initialization

Run this from the repository root:

```bash
just setup
```

`just env-init` creates or completes `apps/api/.dev.vars`:

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
- Fork contributors should initialize submodules before validating a PR; maintainers update submodule pointers only when the PR intentionally changes the vendored revision.
- Treat third-party skills as generic references, not project authority. Active `AGENTS.md`, this guide, existing `wrangler.toml` files, pinned dependencies, and `just`/`bun`/`vp` commands take precedence; a skill must not migrate config formats, upgrade dependencies, or bypass repository command wrappers unless the task explicitly requires that change.

## Local Development

Start the regular local stack:

```bash
just dev
```

This command runs local D1 migration first, then starts the driver build, API Worker, and web app.

Default local URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:8787`

The public landing page and blog live in the private `langgenius/mosoo-website` repository and are deployed separately on `mosoo.ai`.

Local login:

- Regular email login uses OTP.
- Under loopback origins, email addresses ending with `@mosoo.ai` use the local development login channel and skip OTP.

Local development notes:

- D1 migration is not applied automatically on the first request. Run
  `just db-migrate` before starting services. After a DB schema change, run
  `just db-regen`, review the regenerated SQL, then run `just db-reset-local`
  to prove the migration chain against a fresh local database.
- External MCP services used during Preview choose their own documented local
  port; Mosoo does not reserve a `5180+` range for them.
- Before asserting port conflicts or performance problems, measure with `lsof`, `curl`, timing, or another reproducible command.
- On macOS, API dev auto-selects `$HOME/.docker/run/docker.sock` when present,
  even if `DOCKER_HOST` was inherited. Set
  `MOSOO_API_DEV_DOCKER_HOST=unix:///path/to/docker.sock` for another engine, or
  `MOSOO_API_DEV_USE_DEFAULT_DOCKER=1` to keep the inherited Docker host/current
  context. Other platforms keep the inherited/default Docker configuration.

## Common Commands

```bash
just env-init          # create or complete apps/api/.dev.vars
just dev               # apply local migrations and start the local stack
just build             # build driver and web
just fmt               # format
just fmt-check         # check formatting
just lint              # generate Cloudflare types, then run lint
just tc                # run workspace typecheck
just test              # run regular unit tests
just check             # fmt + doc links + lint + tc + tests + GraphQL freshness
just graphql-codegen   # regenerate GraphQL schema and web gql output
just db-regen          # regenerate the Drizzle baseline from the schema
just db-reset-local    # destroy local D1 state and reapply migrations
```

During development, prefer focused commands for faster feedback:

```bash
just tc-package @mosoo/api
just test-package @mosoo/web
just test-file apps/api/tests/session-run-cancel.test.ts
```

## Database And Migrations

Mosoo uses generated Drizzle migrations for local and production D1:

- The schema source of truth is `pkgs/db/src/schema/**`.
- The generated chain currently consists of one squashed baseline,
  `pkgs/db/drizzle/0000_baseline.sql`, which production has recorded.
- `just db-regen` deletes and regenerates that baseline from the schema.
  Wrangler records applied migrations by filename, so a regenerated baseline is
  silently skipped by any database that already recorded it — production will
  never re-run it. Once the baseline has shipped, schema changes must land as a
  new appended migration file instead. There is no `just` recipe for appending
  yet; it is a manual `drizzle-kit generate --name <name>` step in `pkgs/db`,
  reviewed like any other SQL change.
- Destructive or data-rewrite migrations require explicit approval plus a
  separate backup and rollback plan.

Common commands:

```bash
just db-regen        # regenerate the squashed baseline from the schema
just db-reset-local  # destroy local D1 state, then reapply the chain
just db-migrate      # apply pending migrations to existing local state
```

If local state is dirty, use `just db-reset-local`; it deletes only local Wrangler
D1 state and reapplies the chain. Do not hand-edit `pkgs/db/drizzle`.

Production D1 is not reset during deploy. `just deploy-api` runs
`apps/api/bin/deploy-prod.ts`, whose first remote action is applying pending D1
migrations. It then verifies that every baseline table exists in production —
the DEPLOY-D1-001 guard that refuses to deploy a Worker whose schema references
tables a rewritten, silently-skipped baseline never created — ensures the
channel-final-delivery queues, builds the Driver, and deploys the API Worker.
No other automated migration gate exists today: there is no trusted-Git-range
check, no clean-worktree check, and no dry-run inside the deploy script. Run
`just check` and the
[Production Deploy Verification](./docs/production-deploy-verification.md)
runbook before deploying.

## GraphQL Codegen

GraphQL sources of truth are:

- Field and type spec: `apps/api/src/adapters/graphql/graphql-module-specs.ts`
- Runtime resolvers: `apps/api/src/modules/*/graphql/*-graphql.ts`
- API schema entry point: `apps/api/src/adapters/graphql/create-graphql-schema.ts`
- Codegen schema input: `apps/api/src/adapters/graphql/codegen-schema.ts`
- Codegen config: `config/graphql-codegen.ts`
- Web GraphQL documents: `graphql(/* GraphQL */)` in `apps/web/src/**/*.{ts,tsx}`

After changing backend schema, custom scalar mapping, frontend queries, mutations, or fragments, run:

```bash
just graphql-codegen
```

If generated output exposes type or field drift, fix the spec, resolver, contract, or PRD source instead of patching generated files.

## Verification Strategy

Choose validation based on risk and blast radius. The repository is still alpha, so every small change does not need new tests, but high-risk behavior changes need focused coverage.

Recommended baseline:

- Documentation changes: `just fmt-check-path <path>`, plus link / path checks when moving documents.
- TypeScript package changes: `just tc-package <package>` and focused unit tests; run root `just tc` when cross-contract behavior changes.
- API behavior changes: focused `just test-file <path>`; add `just tc-package @mosoo/api` when types or bindings are involved.
- Web behavior changes: focused `just test-file <path>` and `just tc-package @mosoo/web`; user-visible flows need browser or manual checks.
- GraphQL changes: `just graphql-codegen`.
- DB schema changes: `just db-regen`, `just db-reset-local`, and relevant API tests.

E2E entry points:

```bash
just e2e --help
just e2e contract
just e2e public-api
just e2e contract harness
just e2e deterministic session-log
just e2e ui preview
just e2e public-api runtime
just e2e public-api latency
```

`just e2e deterministic session-log` is the local acceptance path without external credentials. `just e2e contract harness` covers local harness contracts that do not need live credentials. Preview and latency cases accept `openai|anthropic`; `public-api runtime` additionally accepts `opencode|deepseek`. Use the matching provider-specific key or `MOSOO_E2E_PROVIDER_API_KEY`. ACP fallback is the runtime path used by the OpenCode and DeepSeek public-API cases and is also covered by driver fixtures and API integration gates.

## Engineering Principles

Keep changes small, direct, and aligned with existing boundaries.

- Prefer existing repository patterns over new abstractions.
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

Use `!` only for intentional breaking changes. PRs should keep a clear scope, describe verification results, and explicitly state whether they include generated files, GraphQL codegen, new DB migration files, or lockfile changes. The frozen baseline is not a normal PR update surface.

### Pull Requests

- Open PRs **only to `main`** (or `release/*`). No PR chains between feature branches.
- Public contributors use a fork PR. Fork branch names may vary, but `type/scope-subject` is preferred when practical.
- Maintainers with repository write access use upstream branches named `type/scope-subject`.
- External contributors may mark maintainer-only items as N/A: assignee, internal verification, release or deployment checks, and any upstream-branch-only workflow notes.
- CLA Assistant runs on PR metadata. If it asks you to sign, read `CLA.md` and post the exact requested PR comment once; do not paste the signature into the PR description.
- CI metadata gates validate PR title, commit messages, CLA status, and ship policy. Non-draft PRs also run the repository check from `.github/workflows/pr-check.yml`.
- Run `just check` before marking ready for review when practical. If you cannot run it, list the smaller commands you did run and why the full gate was skipped.
- Big pivots: update the boundary docs first, then prefer **one umbrella PR** with `just check` and boundary tests as the review contract.

### Enforced Commit Policy

Commit quality is enforced by automation, not contributor memory:

- Local Git hooks via `prek` (`config/prek.toml`)
- PR title lint (`.github/workflows/pr-title-lint.yml`)
- PR commit lint (`.github/workflows/pr-commits-lint.yml`)
- PR repository check (`.github/workflows/pr-check.yml`)
- Direct pushes to `main` are rejected locally and by the GitHub ruleset

Reinstall hooks whenever hook config changes:

```bash
just hooks-install
```

#### Local hook stages

Local hooks stay fast so small commits stay cheap:

- `pre-commit`: file hygiene only (whitespace, EOF, JSON/YAML/TOML validity, private-key detection, merge-conflict markers, and similar auto-fix or fail-fast checks). It does **not** run `just tc`, `just lint`, or `just test`.
- `commit-msg`: validates the commit you are creating — subject format, author identity, committer identity (when different from author), and agent-looking identities in `Co-authored-by:` / `Signed-off-by:` trailers.
- `pre-push`: runs the same commit-metadata validation for every commit in the push range, plus a hard block on direct pushes to `main`.

Run focused verification while you work (`just tc-package <package>`, `just test-file <path>`, `just lint`, and similar). Before opening or updating a PR, run the full gate locally when your change is ready:

```bash
just check
```

CI runs the same full gate on pull requests via `pr-check.yml`.

Rules are defined in `config/commit-policy.ts`:

- Subject must match `type(scope): subject`
- Scope is required; legacy prefixes such as `[codex]`, `YEF-`, `WIP:`, and `Draft:` are rejected
- Subject must start with a lower-case letter after `: `
- Subject length must stay at or below 72 characters
- Standard merge commits (`Merge ...`) are exempt from subject rules
- Author and committer must identify a real human contributor; AI/agent/bot identities are rejected
- `Co-authored-by:` and `Signed-off-by:` trailers are checked with the same identity rules

Rejected identity signals include:

- Tool or automation names such as `claude`, `claude-code`, `codex`, `cursor`, `copilot`, `openai`, `gemini`, `grok`, `aider`, `devin`, `windsurf`, `codegen`, `opencode`, `github actions`, `dependabot`, and `renovate`
- Bot markers such as `[bot]` or a standalone `bot` token in the name
- Agent or automation emails such as `agent@multica.local`, `agent@...`, `agents@...`, `* [bot]@users.noreply.github.com`, and `noreply@openai|anthropic|cursor|copilot.*`

This is attribution hygiene, not cryptographic identity proof. Configure `user.name` and `user.email` to your real contributor identity before committing, and do not leave AI tool defaults in author fields or commit trailers.

To check commit metadata on your branch against `origin/main` locally:

```bash
just commit-check
```

## Deployment Notes

Production deployment scripts exist, but they are not part of the daily contribution flow:

```bash
just deploy       # full repository gate, then API deploy, then Web deploy
just deploy-api   # API only — runs no gate; run `just check` first yourself
just deploy-web   # Web only — runs no gate; does not touch D1
```

Only `just deploy` runs the repository gate before publishing; `just deploy-api`
and `just deploy-web` publish directly. The API deploy applies pending remote D1
migrations as its first remote action (see
[Database And Migrations](#database-and-migrations)).

API production config lives in `apps/api/wrangler.toml`; web production config lives in `apps/web/wrangler.toml`. Cloudflare routes send `try.mosoo.ai/api/*` to the API Worker and `try.mosoo.ai/*` to the console Web Worker. The public landing page and blog on `mosoo.ai/*` are owned by `langgenius/mosoo-website`.

Do not deploy production directly from an unreviewed local branch.

Before a production release, run the tracked simulation and acceptance checklist
in [Production Deploy Verification](./docs/production-deploy-verification.md).
