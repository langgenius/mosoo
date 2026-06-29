# Mosoo Contributing Guide

Mosoo is still in alpha exploration, and the repository moves quickly. This document only describes the development and contribution flow that is currently real and usable in this repository, avoiding stale instructions inherited from older versions.

## Before You Start

Before changing code, read the relevant product and architecture documents:

- PRD index: [docs/prd/README.md](./docs/prd/README.md)
- Architecture design: [docs/architecture.md](./docs/architecture.md)

These documents define system boundaries, module relationships, and design intent. If the PRD, architecture, and implementation disagree, fix the source of truth instead of hiding the mismatch in generated files, local adapters, or temporary branches.

When a change pivots a core noun or ownership boundary, update the documentation anchor first: README, roadmap, architecture, PRD index, and the active boundary PRD. For the current App boundary cut, [App Boundary](./docs/prd/app-boundary.md) is the construction lock that resolves older Organization-owned, member-governance, Workspace, and Agent-first wording.

## Repository Structure

This repository is a monorepo:

| Path                   | Description                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`             | Cloudflare Worker API with GraphQL, auth, sessions, channels, runtime control plane, and D1/R2/DO bindings.                     |
| `apps/web`             | React web app built with Vite Plus and deployed as Cloudflare Worker assets.                                                    |
| `apps/driver`          | Agent runtime driver bundle used by API Worker / Sandbox paths.                                                                 |
| `pkgs/contracts`       | Cross-boundary TypeScript contracts and parser surfaces; cross app / package DTOs should go here first.                         |
| `pkgs/db`              | Drizzle schema and the current generated baseline migration.                                                                    |
| `pkgs/*`               | Runtime-neutral shared packages for events, policy, package format, observability, dev auth, effects, and related capabilities. |
| `e2e`                  | Playwright local acceptance scripts and runtime signal contract checks.                                                         |
| `config`               | Shared repository tooling config (prek, GraphQL codegen, TypeScript bases, lint).                                               |
| `scripts`              | Repository automation scripts (commit policy validation, exports, codegen checks).                                              |
| `docs/prd`             | Product contracts and writing standards.                                                                                        |
| `docs/architecture.md` | Stable engineering boundaries and system-level contracts.                                                                       |

The following generated files must not be edited by hand:

- `apps/api/src/adapters/graphql/schema.generated.graphql`
- `apps/web/src/gql/**`
- `pkgs/db/drizzle/**`

If generated output is wrong, fix the schema, contract, resolver, or PRD source that produced it.

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

## Local Development

Start the regular local stack:

```bash
just dev
```

This command runs local D1 migration first, then starts the driver build, API Worker, web app, and blog.

Default local URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:8787`
- Blog: `http://localhost:4321/blog` (Astro dev server; mounted at the `/blog` base path with `trailingSlash: "never"`, so the URL must be `/blog` with no trailing slash — `/` and `/blog/` both 404)

Local login:

- Regular email login uses OTP.
- Under loopback origins, email addresses ending with `@mosoo.ai` use the local development login channel and skip OTP.

Local development notes:

- D1 migration is not applied automatically on the first request; run `just db-migrate` or `just db-regen` before starting services.
- Preview MCP development services use ports `5180+`; ports `5173` and `5174` are reserved for local web / dev flow.
- Before asserting port conflicts or performance problems, measure with `lsof`, `curl`, timing, or another reproducible command.

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
just check             # fmt:check + lint + tc + test
just graphql-codegen   # regenerate GraphQL schema and web gql output
just db-regen          # regenerate the Drizzle baseline from the current schema
```

During development, prefer focused commands for faster feedback:

```bash
just tc-package @mosoo/api
just test-package @mosoo/web
just test-file apps/api/tests/session-run-cancel.test.ts
```

## Database And Migrations

During alpha, historical migrations are not maintained. The database policy stays simple:

- The schema source of truth is `pkgs/db/src/schema/**`.
- The current baseline is `pkgs/db/drizzle/**`.
- When schema and database state diverge, do not add compatibility patches for old local data.
- Rebuild the local database state directly.

Common commands:

```bash
just db-regen
just db-migrate
```

If local database state is dirty, delete the corresponding local database and `.wrangler` state directories, then rebuild. Production release follows the same no-history posture: unless the current schema explicitly supports old data, old data is not considered compatible.

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
- DB schema changes: `just db-regen` and relevant API tests.

E2E entry points:

```bash
just e2e --help
just e2e api
just e2e contract
just e2e public-api
just e2e contract harness
just e2e deterministic session-log
just e2e ui preview
just e2e public-api runtime
just e2e public-api latency
```

`just e2e deterministic session-log` is the local acceptance path without external credentials. `just e2e contract harness` covers local harness contracts that do not need live credentials. Live runtime cases require a provider key such as `MOSOO_E2E_OPENAI_API_KEY`, `MOSOO_E2E_ANTHROPIC_API_KEY`, or `MOSOO_E2E_PROVIDER_API_KEY`; set `MOSOO_E2E_PROVIDER=openai|anthropic` to choose the public runtime provider. ACP fallback is an internal transport covered by driver fixture and API integration gates.

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

Use `!` only for intentional breaking changes. Every Issue and PR must be self-assigned. PRs should keep a clear scope, describe verification results, and explicitly state whether they include generated files, GraphQL codegen, or DB baseline updates.

### Pull Requests

- Open PRs **only to `main`** (or `release/*`). No PR chains between feature branches.
- Private-stage PRs should use branches in the upstream repository so required `pull_request` checks can run.
- Fork PRs are usable only when private fork workflows are enabled, or when a maintainer handles verification and bypass explicitly.
- Metadata gates support fork PRs through `pull_request_target`; upstream branch PRs still use `pull_request`.
- Repository code checks stay on `pull_request`.
- Branch names use `type/scope-subject` above.
- Run `just check` before marking ready for review. CI runs the same gate for non-draft `pull_request` PRs.
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
just deploy-api
just deploy-web
just deploy
```

API production config lives in `apps/api/wrangler.toml`; web production config lives in `apps/web/wrangler.toml`. Cloudflare routes send `try.mosoo.ai/api/*` to the API Worker, `try.mosoo.ai/*` to the console Web Worker, and `mosoo.ai/*` to the marketing / landing surface.

Do not deploy production directly from an unreviewed local branch.
