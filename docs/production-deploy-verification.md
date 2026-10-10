# Operator Runbook

How to release mosoo to stage and production, recover from a failed release,
manage operator credentials, notify users and handle incidents.

## Rules

- Production D1 is append-only: never reset it, and never edit, rename, delete
  or roll back an applied migration. Destructive or data-rewrite migrations need
  explicit owner approval, a backup and a rollback plan
  ([authoring rules](../CONTRIBUTING.md#database-and-migrations)).
- Production deploys only reviewed commits, normally by advancing `deploy/try`
  to a `main` commit.
- Never cancel a running release: D1, queues and the two Workers change one
  after another, not in one transaction.
- Keep account IDs, tokens and secret values out of tracked files, issues and
  shared output. Stop if the target Cloudflare account is unclear or a secret
  appears in output or a diff.

## Production Release

1. Publish the commit to [stage](#staging) and run the
   `Public API non-production smoke` workflow against its `/api/v1` URL.
2. Complete the [migration review](#migration-review).
3. Push the commit to `deploy/try`. `deploy-try.yml` runs the gate, a
   migration-chain replay into a temporary local D1, a read-only ledger check
   and a queue listing, the builds, both Worker dry-runs, `just deploy` and
   endpoint checks.
4. Run the [post-deploy checks](#post-deploy-checks).

For a manual release, which every release with pending migrations needs:

- Use a clean worktree, including the `apps/driver` submodule; the deploy ships
  whatever is on disk. `git status` hides ignored files and paths marked
  `assume-unchanged` or `skip-worktree`, so check for those too. Docker must be
  running for the Sandbox image builds, dry-runs included.
- Remove app-local `.env*` files and export exactly the `VITE_*` values from
  `deploy-try.yml`; Vite bakes them into the console at build time.
- Run the workflow's steps through the dry-runs; the ledger check may fail only
  on the pending migrations you reviewed. Then run `just deploy`.
  `just deploy-api` and `just deploy-web` skip `just check`.

`just deploy` runs `just check`, the API deploy and then the Web deploy. The API
deploy, [`deploy-prod.ts`](../apps/api/bin/deploy-prod.ts), applies migrations
only when configured SQL files are missing from the ledger, then checks the
ledger again. Its DEPLOY-D1-001 guard requires every table in the latest Drizzle
snapshot to exist in production; columns and indexes are not compared. It
creates the `environment-artifact-build` queue if missing; the other queues in
`[env.prod]` of `apps/api/wrangler.toml` must already exist. It deploys with
`--containers-rollout immediate`, so the API and Driver, which must share
`DRIVER_PROTOCOL_VERSION`, never split across a gradual rollout. This stops
every running Sandbox at once and ends in-flight turns.

## Migration Review

- No automated check enforces append-only. Diff `pkgs/db/drizzle/` against the
  last deployed commit, normally `origin/deploy/try`: it may only add SQL and
  snapshot files and append journal entries. Wrangler records migrations by
  filename, so production silently skips an edited applied file.
- Inspect production with `bun bin/prod-migrations.ts` from `apps/api`, never
  `wrangler d1 migrations list`, which runs DDL. The inspector fails while
  migrations are pending, when the ledger is missing or unreadable, and when
  production has applied a migration absent from the checkout. Initializing a
  database without a ledger is a separate reviewed operation.
- Pending migrations ship only when additive or explicitly approved. Because the
  inspector fails on them, `deploy/try` stops; release them manually.

## Partial Failure And Rollback

- The API publishes first. If the Web publish fails, keep the commit and the
  `VITE_*` values, fix the cause, build and dry-run the Web as the workflow
  does, then run `just deploy-web`.
- If the API deploy fails, fix the cause and rerun `just deploy`; applied
  migrations are skipped. Wrangler activates the new Worker before it builds the
  Sandbox image and starts the rollout, so a failure in those steps leaves the
  new Worker running against the old image.
- Roll back by releasing a revert from `main` that keeps every migration file;
  the inspector refuses a checkout that lacks an applied one. The revert also
  restores the pinned Driver, so the API and Driver move together.
- The rollback build must accept every row the newer build admitted, such as a
  Session without an Agent. Never delete rows or invent values to fit it.

## Native checkpoint cutover

- Before activating a Driver that requires verified native bundles, drain its legacy instances and retain the previous API, Driver, native runtime version and checkpoint format as a tested recovery pair.
- Legacy Sessions require manual verification of the archived native records against their committed Run before recovery under the new contract.
  There is no automatic migration command.
  Keep archives and metadata intact, and keep a Session on an isolated compatible deployment when its archive cannot prove that boundary.
- Approve cutover only after stage demonstrates a new checkpoint, cold restore with current workspace edits preserved, and rejection of an unverifiable legacy checkpoint.
  A rollback must use the retained version and format pair; changing the Driver alone does not prove that newer native records can be read.

## Runtime image namespace compatibility

`MOSOO_RUNTIME_IMAGES_ENABLED` gives new runtime subjects a per-runtime Sandbox
class. It is `"false"` in every environment, so they use the union `Sandbox`.

- Turn it on only in its own reviewed deploy, after stage runs the same change,
  while the Worker that routes by `sandbox.sandbox_binding` and every Sandbox
  class are live. Turning it off stops new per-runtime allocations only.
- A subject's recorded `sandbox_binding` is never redirected or rewritten. Once
  any subject records a per-runtime class, every later deploy and rollback keeps
  that column and every Sandbox class and binding.
- Durable Object class migrations in `wrangler.toml` are append-only.

## Post-Deploy Checks

- The workflow's Verify step checks the public endpoints and redirects; run the
  same commands after a manual release.
- A successful deploy means the container rollout started. After a release that
  touches the runtime, the Driver or provider routing, let the rollout finish,
  then complete one real tool-executing turn through the Public API in an
  operator-owned Project. Health checks do not prove model execution.
- Confirm that [mosoo.ai/status](https://mosoo.ai/status) shows fresh
  observations.

## Staging

Stage has its own Workers, D1, R2 buckets, queues and synthetic data
(`[env.stage]` in both `wrangler.toml` files). Only `just deploy-stage` publishes
to stage; `deploy/try`, `just deploy`, `just deploy-api` and `just deploy-web`
target production.

- Apply stage migrations separately from `apps/api`, after the chain replays
  locally, with a reviewed
  `../../node_modules/.bin/vp exec wrangler d1 migrations apply DB --remote --env stage`.
  Never reset stage D1; it may hold long-lived Sessions for
  delayed-continuation tests.
- Finish or cancel running stage work, because container rollout is immediate.
  Commit, then run `just deploy-stage`: it runs `just stage-preflight`, refuses
  a dirty tree, and deploys the API and then the Web, tagged with the commit SHA
  and the message `mosoo=<sha> driver=<sha>`. It applies no migrations or
  secrets, and the two updates are not atomic.
- Let the container rollout finish for every Sandbox application. Test with a
  dedicated stage Project and key, and add provider credentials in the console,
  never as Worker secrets.
- Run the smoke workflow (or `just public-api-smoke`) and
  `just public-api-session-workflow`. Both refuse production hosts.

## Credentials

GitHub environments:

- `try`, limited to `deploy/try`: `CLOUDFLARE_ACCOUNT_ID`, the deploy
  `CLOUDFLARE_API_TOKEN` and `POSTHOG_PROJECT_KEY`. Protect `deploy/try` from
  force-push and deletion, and restrict who may push it.
- `container-monitor`, limited to `main` because scheduled runs execute there:
  `CLOUDFLARE_ACCOUNT_ID` and a `CLOUDFLARE_API_TOKEN` limited to Containers
  Read, never the deploy token. With it, the `Container runtime alert` workflow
  opens `[Ops]` issues for container count or age anomalies in prod and stage;
  it never stops a container. A job fails when the token is missing or cannot
  read containers, when the account cannot be resolved, or when a container
  application derived from `apps/api/wrangler.toml` is missing from Cloudflare,
  for example a class merged to `main` but not yet released. After setting or
  rotating the secrets, run it with `workflow_dispatch` and confirm both jobs
  pass.
- `public-api-nonproduction`: the stage Agent and Project key for the smoke
  workflow, never a production key.

Required Worker secrets are listed in `[env.prod.secrets]` and
`[env.stage.secrets]` of `apps/api/wrangler.toml`. Set one from `apps/api` with
the pinned Wrangler:
`../../node_modules/.bin/vp exec wrangler secret put <NAME> --env prod`.

- `VAULT_ROOT_SECRET` wraps the key of every stored provider key, MCP credential
  and Environment secret, with no versioning. Replacing it makes all of them
  unreadable; never rotate it in place.
- Sandbox file mounts and checkpoint uploads and restores authenticate with
  `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`, so a revoked or under-scoped
  token fails every checkpoint and cold restore. The production pair is a
  non-expiring Cloudflare user token limited to object read/write on the
  production file and sandbox-state buckets; transfer it before removing that
  user.
- `POSTHOG_PROJECT_KEY` (Worker secret) and its GitHub namesake are optional;
  without them the API and the console send no product events. Both take the
  PostHog project's public ingestion key. Keep stage without one, because stage
  labels its events `production`.

The production API names `mosoo-website-prod` (`langgenius/mosoo-website`) as
its Tail consumer. That Worker builds mosoo.ai/status and must exist with a
`tail()` handler before an API deploy names it.

## Breaking-Change Notification

[SPEC](./SPEC.md) decides when a change needs a notice. To send one:

1. Before the release, snapshot the affected recipients and write the notice:
   effective time, actual changes, preserved data, and the steps users take. A
   notice saying the replacement is available goes out only after the API,
   console and applicable CLI are deployed and verified.
2. Check a sample inbox for delivery and content, then send individually through
   Cloudflare Email Service. Keep private per-recipient attempts, outcomes and
   provider message IDs, and resolve unknown outcomes before any retry.
3. Notification is complete only when the snapshot reconciles: no unknown or
   unattempted recipients, and every known failure investigated with its
   disposition recorded. Provider acceptance is not inbox delivery. Publish
   only aggregate counts.

## Incidents

A production failure that affects users is an incident.

- While it is live, keep the incident issue current. [mosoo.ai/status](https://mosoo.ai/status)
  shows automated telemetry only and has no manual notice channel.
- Open a GitHub issue from the
  [Incident template](../.github/ISSUE_TEMPLATE/incident.yml). Its timeline,
  evidence and postmortem stay in that issue, not in docs. Significant customer
  impact, such as data loss or multi-hour unavailability, also gets a public
  postmortem.
- Close it once the fix ships with a regression test that pins it, and move any
  standing rule into [architecture](./architecture.md) or this runbook.
- Earlier postmortems are archived in
  [operations/incidents](./operations/incidents/README.md).
