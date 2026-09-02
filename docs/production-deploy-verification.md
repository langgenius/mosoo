# Production Deploy Verification

This runbook simulates `just deploy` without publishing Workers or mutating production D1.
It also defines the fail-closed protocol-v3 gates that the real production deploy runs before any production mutation.

## Rules

- Do not put Cloudflare account IDs, zone IDs, API tokens, secret values, or private keys in tracked files.
- Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` only in the shell that runs the check.
- Remove app-local `.env*` files that Wrangler or Vite would load implicitly, and unset every `VITE_*` process variable before a production build.
- Export the production account ID and API token in the current shell.
- The token needs the existing D1, Queues, Containers, and Workers Scripts permissions used by the production deploy.
- Every Wrangler deploy command, including dry-runs and real API and Web publication, must include `--experimental-provision=false`.

```bash
export CLOUDFLARE_ACCOUNT_ID="<production-account-id>"
export CLOUDFLARE_API_TOKEN="<production-api-token>"
```

- During simulation, do not run:

```bash
just deploy
just deploy-api
just deploy-web
bun run deploy
bun run deploy:api
bun run deploy:web
```

Those commands publish or mutate production resources.

## Step 0 - Confirm The Worktree

```bash
git status --short --branch
```

Acceptance:

- Current branch is the intended release branch or `main`.
- The whole repository, including `apps/driver`, has no staged, unstaged, or
  untracked changes.
- No tracked path uses Git `assume-unchanged` or `skip-worktree`.
- The API deploy enforces both conditions, but this manual check confirms the
  intended release before any production command is invoked.
- No ignored file exists under the Web `src` or `public` build-input
  directories.

## Step 1 - Run The Full Repository Gate

```bash
just check
```

Acceptance:

- Command exits `0`.
- Formatting, lint, typecheck, tests, and generated output checks pass.
- The in-memory Drizzle source-to-latest-snapshot check passes without creating
  temporary migration files.
- The complete in-memory SQLite migration chain matches that latest snapshot's
  managed catalog.

## Step 2 - Confirm Production D1 Migration State

Execute the complete migration chain against an isolated local D1 database:

```bash
(
  cd apps/api
  persist_dir="$(mktemp -d)"
  trap 'rm -rf "$persist_dir"' EXIT
  ../../node_modules/.bin/vp exec wrangler d1 migrations apply DB \
    --local --env prod --persist-to "$persist_dir"
)
```

Finally inspect the remote ledger. This is read-only and must not apply migrations:

```bash
cd apps/api
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  ../../node_modules/.bin/vp exec wrangler d1 migrations list DB --remote --env prod
cd ../..
```

Acceptance:

- The isolated full-chain apply exits `0`, proving the checked-in SQL chain
  actually executes before production. No automated append-only or
  trusted-range check exists; review the diff of `pkgs/db/drizzle/**` against
  the last deployed commit by hand. Remember that Wrangler records applied
  migrations by filename: a rewritten migration is silently skipped by a
  production database that already recorded it.
- For a no-op schema release, output says no migrations need to apply.
- If pending migrations are listed, stop and review the exact SQL before any
  real deploy.
- Pending migrations may be accepted only when they are additive or explicitly
  approved for production.

## Step 3 - Confirm Production Queues Exist

This is read-only. It must not create queues.

```bash
cd apps/api
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  ../../node_modules/.bin/vp exec wrangler queues list
cd ../..
```

Acceptance:

- `api-command` exists.
- `api-command-dlq` exists.
- `environment-artifact-build` exists.

## Step 4 - Build The Driver

```bash
./node_modules/.bin/vp run --filter agent-driver build
```

Acceptance:

- Command exits `0`.
- Driver bundle is produced without TypeScript or bundling errors.

## Step 5 - Dry-Run The API Worker Upload

This validates the API Worker bundle without publishing it. It does not run the
full API deploy script because the real script applies D1 migrations and ensures
the required environment-artifact queue.

```bash
cd apps/api
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  ../../node_modules/.bin/vp exec wrangler deploy --env prod --minify --dry-run --experimental-provision=false
cd ../..
```

Acceptance:

- Command exits `0`.
- Wrangler validates the `prod` environment.
- No Worker is deployed.
- No D1 migration is applied.
- No queue is created.

## Step 6 - Build The Web Worker Assets

```bash
./node_modules/.bin/vp run --filter @mosoo/web build
```

Acceptance:

- Command exits `0`.
- Web build succeeds.
- `apps/web/dist` is produced.

## Step 7 - Dry-Run The Web Worker Upload

```bash
cd apps/web
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  ../../node_modules/.bin/vp exec wrangler deploy --env prod --dry-run --experimental-provision=false
cd ../..
```

Acceptance:

- Command exits `0`.
- Wrangler validates the `prod` environment.
- No Worker is deployed.

## Step 8 - Confirm The Production D1 Contract

```bash
rg -n "wipeProdD1|Wiping prod D1|database delete|database create" apps/api/bin/deploy-prod*.ts
```

Acceptance:

- The `rg` command returns no matches.
- `apps/api/bin/deploy-prod.ts` still performs, in order: load and validate the latest local Drizzle snapshot, verify the Driver protocol pin, build the Driver, and dry-run the API Worker.
- Only after local artifact and contract checks pass does it acquire the production
  D1 deploy lease and continue to Queue or D1 mutation.
- If any local D1 migration is pending, or the one-shot gate remains from an
  interrupted release, the script follows the closed cutover sequence below
  instead of migrating beside live Workers or treating `immediate` as an atomic
  rollout.
- The complete ordered local filename list must equal
  `AUDITED_MIGRATION_NAMES` and end at `LAST_CUTOVER_AUDITED_MIGRATION`.
  Adding, inserting, renaming, or substituting a migration filename fails before
  any remote mutation until its tables, admissions, rebuilds, gate, and drain
  have been reviewed and that explicit list is deliberately advanced.
- The schema guard compares every managed table's columns, primary-key order,
  defaults, nullability, named indexes and partial predicates, foreign keys,
  CHECK expressions, autoincrement state, and the exact migration-owned
  `session_event_tool_identity_consistency` trigger with the latest migration
  contract.
- Unknown application triggers fail closed.
- Unknown extra application tables fail closed.
  Twelve Channels, WeChat, and App Deployment tables are explicit exceptions
  because #577 and #591 removed those runtime subsystems without approved
  destructive data migrations.
  The exact allowlist is `agent_channel_binding`,
  `bound_agent_call_idempotency_key`, `channel_event_receipt`,
  `channel_final_delivery_job`, `channel_runtime_state`,
  `channel_thread_session`, `project_deployment`,
  `project_deployment_run`, `project_deployment_secret`,
  `wechat_channel_account`, `wechat_channel_pairing`, and
  `wechat_context_token`.
  They have no current runtime reader or writer, but their historical data is
  retained until a separate disposal and recovery plan is approved.
- The API script refuses a dirty tracked or untracked worktree and dirty or
  moved submodules before local preflight, then repeats that check after the
  Driver build and Worker dry run.
- Steps 0-4 and 6-7 remain required to review the intended commit and complete
  repository checks before invoking a production command.

## Durable API Deploy Mutex

Every ordinary API deploy and protocol-v3 cutover acquires one row in `__production_deploy_lease` before queue creation, D1 migration, Queue delivery changes, API Worker publication, or production smoke writes.

The acquisition inserts one owner UUID only when the table is empty.

It sends that mutating acquisition batch exactly once.

The mutex never expires and never transfers ownership automatically.

Every remote mutation verifies that exact owner immediately before and after the mutation without extending or changing the mutex.

The mutation result is not treated as ownership evidence.

An independent final D1 read must still return the exact owner, the canonical lease table SQL, and zero triggers attached to that table.

Only a completely successful API deployment releases the mutex automatically.

A failed or unproven acquisition never issues a compensating delete because a timed-out request may still commit later.

Any failure after acquisition deliberately leaves the owner row in place because a timed-out Cloudflare request may still be completing remotely.

Before an exact-owner manual release, an operator must prove that the original deploy process has stopped, every remote mutation is quiescent, and the Worker, Container, Queue, D1, and cutover-gate state has one exact recoverable result.

Elapsed time is never evidence that the mutex is safe to release.

Release deletes only the exact current owner's row, so a stale process cannot delete another owner's mutex.

The empty mutex table remains for reuse by later deploys.

The Web Worker is outside this API/D1/Queue cutover boundary and continues to use workflow concurrency.

## Audited One-Shot Production Migration Cutover

Migration `0014_durable-mcp-effect-v3.sql` was the historical reason for introducing the cutover gate, but its filename is not a deployment sentinel.
Any migration that was pending when the audited deploy began uses the same closed admission, complete drain, bookmark, migration, rollout, smoke, and Queue-resume sequence.
The canonical audited journal and its current boundary are `AUDITED_MIGRATION_NAMES` and `LAST_CUTOVER_AUDITED_MIGRATION` in `apps/api/bin/protocol-v3-cutover.ts`.

Before scheduling a release in which `0014_durable-mcp-effect-v3.sql` is pending, run its read-only loss inventory:

```bash
bun apps/api/bin/deploy-prod.ts --protocol-v3-lossy-migration-inventory
```

The command counts oversized MCP arguments, input text, input results, control reasons, permission payload rebuilds, MCP results, provider receipts, command errors, and Session Run errors.

It also detects duplicate command-payload keys, orphan effects, missing terminal-attempt timestamps, conflicting MCP result copies, conflicting provider receipts, and succeeded effects that disagree with their command terminal state.

Successful MCP results keep the authoritative effect JSON text byte for byte.

Any existing command or succeeded-attempt result copy must match that authority exactly before migration.

It prints at most 50 stable category and row ID pairs and never prints a payload, result, receipt, or error body.

Every category must be zero.

There is no implicit approval flag.

The deploy repeats this inventory after the complete drain and before any migration is applied.

Migration `0014` repeats the same predicates at the start of its transaction, so a direct migration attempt with any candidate aborts before changing schema or history.

Before scheduling a release in which `0015_session-event-stream-identity.sql` is pending, run the read-only production terminal inventory:

```bash
bun apps/api/bin/deploy-prod.ts --protocol-v3-legacy-inventory
```

The command groups `run.completed`, `run.cancelled`, and `run.failed` history and
prints canonical sources, deterministic rewrite candidates, canonical-target
collisions, broken Run links, status/kind mismatches, and Runs with multiple
terminal events.

The `run.cancelled` group covers both `cancelled` and `expired` Run statuses.

It performs no build, Queue mutation, migration, Worker deploy, or Container
rollout.

It exits nonzero for a collision, broken link, status/kind mismatch, or multiple
terminal winners.

Provider source IDs are allowed as rewrite candidates because migration `0015`
can derive the exact canonical source from an unambiguous Run and event kind.

The collision guards and source rewrite are one migration, and
[Cloudflare documents](https://developers.cloudflare.com/d1/wrangler-commands/#d1-migrations-apply)
that a failed D1 migration is rolled back.

Treat this inventory as an explicit human release gate and investigate every
collision or multiple winner before starting the production cutover.

The deploy repeats the same inventory behind the closed admission gate, so a
change after the manual check still fails closed.

The deploy identifies its immutable release by the clean `HEAD^{tree}` Git tree
OID before any production mutation.

That tree identity covers every tracked file, executable mode, and submodule
gitlink, and the deploy rejects tracked changes, untracked files, and dirty or
moved submodules.

It repeats the clean-tree check after the Driver build and Worker dry run, so
local preflight cannot silently change the release being deployed.

The Worker version receives the native `protocol-v3-<tree OID>` Wrangler tag.

The gate binds the clean release tree before drain or migration.

Only after Container convergence, health, live smoke cleanup, and final
readback does it atomically add the exact Worker version ID, Container
application version, and OCI image digest.

Every entry with an existing gate verifies its release tree, and a recovery
with bound rollout metadata verifies all three identities before any Queue
mutation.

A retry from another tree is rejected, while a retry with stored rollout
metadata skips publication and verifies the already-bound rollout.

A crash after publication but before metadata persistence may publish the same
clean tree again; it cannot adopt metadata already bound to another rollout.

The deploy script performs this sequence automatically:

1. It compares the remote migration ledger with the local journal as an exact prefix.
   Any initially pending migration within the explicitly audited journal uses this closed path.
   A migration beyond `LAST_CUTOVER_AUDITED_MIGRATION` fails before production mutation rather than inheriting safety from an older gate definition.
2. It installs or verifies the canonical `__protocol_v3_cutover` table and temporary triggers.
   Object definitions and counts come only from the canonical pre-migration or post-migration arrays in `apps/api/bin/protocol-v3-cutover.ts`, and the deploy consumes their generated SQL and count constants.
   The migration-chain test compares the runtime-authority migration tail with the canonical post-migration catalog, so this runbook deliberately does not duplicate object counts.
   A fresh database may contain the exact empty post-migration table and inert triggers; the installer atomically seeds its single release-bound row.
   Any partial, extra, renamed, or differently defined protected object fails closed.
3. It pauses `api-command`, `api-command-dlq`, and
   `environment-artifact-build`, then reads every Queue through the Cloudflare
   API and requires `delivery_paused = true`.
   A durable `queues_resuming` retry follows the recovery rules below instead of
   pausing before its phase is read.
4. The gate blocks new active Session Runs, live Drivers, nonterminal business Driver commands, non-cold Sandboxes, live Sandbox Sessions, in-progress backups, and non-static Session lifecycle state.
   It immediately rejects new queued or running `session_run_dispatch`, `app_deployment_run_dispatch`, and `environment_package_artifact_build` API commands while the first drain still permits reconciliation and control commands.
   When the runtime-authority schema is present, the gate also blocks runtime-provisioning leases, cleanup operations, Sandbox operation authority, and Sandbox backup staging.
   An Environment artifact command created before the gate may create backup staging only while it still owns the exact current generation, attempt, claim, unexpired lease, app, and input digest.
   Every other Environment artifact backup staging insert fails closed.
5. Existing work may move only toward a terminal or cold state.
   Already-admitted business commands and necessary reconciliation or control continuations remain available during the first drain.
   The gate never rewrites an active Sandbox to `cold`; an unsafe Sandbox must
   finish through the supported hibernate or checkpoint lifecycle path.
6. It temporarily resumes `api-command`, `api-command-dlq`, and `environment-artifact-build` behind the gate and reads all three delivery states back so every already-admitted lane can settle.
   Repeated new business-admission requests remain rejected and cannot starve the drain.
   It then waits for the complete canonical drain to reach zero.
   The drain covers active Session Runs.
   It covers live Driver instances.
   It covers executing or claimed external tool effects.
   It covers queued, delivered, or accepted Driver commands.
   It covers queued or running API commands.
   It covers Sandboxes that are not cold or still hold operation or claim authority.
   It covers Sandbox Sessions that are not closed or errored.
   It covers Sandbox backups that are not ready or pruned.
   When the corresponding tables exist, it covers every Sandbox backup staging row and every Environment package artifact backup staging row.
   It covers Sessions that are not static, including cleanup and runtime-provisioning authority in the runtime-authority schema.
   `PROTOCOL_V3_CUTOVER_DRAIN_SQL` and `PROTOCOL_V3_POST_MIGRATION_CUTOVER_DRAIN_SQL` are the source of truth for this boundary.
7. One atomic D1 update enables the final freeze only if no queued or running API
   command exists.
   The frozen gate rejects new Driver commands, new API commands, terminal-command
   retries, and delivery-generation rotation.
   It then re-pauses and reads back all three API command lanes before repeating the complete zero-state read.
8. A 15-minute drain timeout fails before migration and reports the unsafe
   Sandbox identities.
9. Before migration `0014`, it runs the read-only loss inventory above and requires every category to be zero.
   The migration repeats the same guard before its first schema or data rewrite.
10. Before migration `0015`, it checks every legacy terminal Run, terminal event,
    and linked assistant projection.
    Duplicate terminal winners, Run-status/event-kind mismatches, missing terminal
    events, broken Run/session links, ambiguous assistant rows, and failed Runs
    without an authoritative error block the migration.
    Every legacy terminal must have a committed timestamp and lifecycle event, no
    permission request, and cursors that include its terminal event and assistant
    projection.
    A provider source is rewritten only when its exact
    `session-run-terminal:<run>:<kind>` target is unused.
    Existing terminal events keep `semantic_hash = NULL` as explicit legacy
    history.
11. Before migration `0020`, it reports legacy Sandbox identities and backup rows
    that the migration's authoritative transaction guard will reject.
    Terminal backups require a nonempty directory, a completed Run with the exact
    Agent and Pet/Cattle subject authority, and a matching Sandbox Session on the
    same Sandbox and directory.
    The read-only deploy preflight improves diagnostics; the guard inside the
    migration is the authority against races.
12. For every pending migration set, it creates or reuses a D1 Time Travel
    bookmark and persists it in the release-bound gate.
    The bookmark is emergency recovery evidence, not an automatic rollback plan.
13. Immediately before applying migrations, it pauses and independently reads back all three Queues again, verifies the exact gate, re-verifies the clean Git tree, and persists the irreversible migration intent.
14. When `0015` is pending, it then records the exact rewrite manifest in a fresh 600-second authorization bound to the deploy mutex owner, bookmark, clean release tree, candidate count, and canonical candidate identities.
    Migration `0015` repeats the full checks in its transaction and requires the exact canonical pre-migration gate before changing a source identity.
15. It immediately applies all pending migrations and requires the remote ledger to equal the complete local journal afterward.
    D1 rolls back a failed migration while the gate and paused Queues preserve a
    safe boundary until recovery proves whether any earlier migration committed.
    Migration `0020` drops the old temporary triggers before table rebuilds and
    recreates the exact post-migration gate in the same transaction.
16. It verifies the latest schema snapshot, publishes the exact tagged Worker and
    Container image, and resolves the registry tag to its OCI SHA-256 digest.
17. It follows every Containers API page and waits until every instance is
    inactive or runs the target application version and digest.
    It then runs deep health and a real API-to-Sandbox Driver boot, protocol-v3
    hello, and ready smoke without starting a model turn.
18. The smoke configuration must identify an existing published `cattle` Agent
    and a dedicated PAT.
    The gate permits only the exact account and unique request-key pair until the synthetic Session is known, then only that exact Session, Sandbox, Run, and Driver chain.
    It never grants an account-wide smoke bypass, so another request or Session from the same account remains blocked.
    Cleanup may enqueue only the exact smoke Driver's `session.stop` command.
    The script deletes the synthetic Thread in `finally`, closes the smoke
    allowance, and rechecks the full post-migration zero-state boundary.
19. Only after rollout convergence, health, smoke cleanup, and final Worker,
    application-version, tag, and digest readback does it persist immutable
    rollout metadata in the gate.
20. It persists `queues_resuming` with admission still closed, resumes each Queue,
    and independently requires `delivery_paused = false` for all three.
    Only then does it persist `enabled = 0` as the acceptance commit and remove
    the one-shot table and triggers.
    A lost response is retried idempotently from the durable phase.

The cutover protects against concurrent or stale deploy processes and failed or
lost Cloudflare responses.

Its database trust boundary is the production D1 administrator: an actor with
arbitrary schema-DDL authority can replace tables or triggers and is outside the
deployment-adversary model.

Keeping that operator boundary explicit lets a fresh migration chain with no
legacy rewrite candidates remain self-contained, while any candidate rewrite
still requires the exact frozen gate, lease, bookmark, release, authorization,
revoker, foreign key, and protected-trigger inventory.

Set `MOSOO_PROTOCOL_V3_SMOKE_AGENT_ID` and
`MOSOO_PROTOCOL_V3_SMOKE_TOKEN` to an existing published `cattle` production
smoke Agent and its dedicated PAT.

Do not use that Agent or PAT for normal traffic.

The script derives the PAT's account ID from the authenticated GraphQL viewer and stores a unique request key before Thread creation.
The temporary allowance is the exact account and request-key pair until the Session is known and the exact resulting Session, Session-scoped Sandbox, Run, and Driver chain afterward.
There is no account-wide allowance, and another request from the same account remains blocked.

A `pet` Agent is rejected before the deploy mutex is acquired because its
Agent-scoped Sandbox cannot satisfy that exact synthetic Session chain.

Cloudflare activates the Worker before its Container rollout finishes, and a
successful deploy only means that rollout started.

The instance-version poll is therefore part of the cutover gate; the
`immediate` flag alone is not acceptance evidence.

On failure, the script rereads the exact migration ledger and compares it with
the pending set captured at cutover entry.

If none of those migrations committed, it resumes and reads back every Queue,
then removes the gate and reports the original error.

If any initially pending migration committed, it pauses and reads back every
Queue, preserves the admission gate or queue-resume marker and bookmark, and
exits failed.

At that point, keep production closed and rerun the exact same v3 release.

That roll-forward is the only default or automated recovery path after any
migration from that cutover commits.

A roll-forward retry never reopens `api-command` merely because a particular
historical migration name is present.

It first recovers any interrupted smoke request, closes the exact request-scoped smoke allowance, keeps the final command freeze active, and proves every counter in the complete canonical drain above is zero again.

Only then does it reuse the persisted bookmark and continue the migration or
run a fresh acceptance smoke.

If migration `0015` fails, its rewrite authorization remains bound to the failed deploy owner and expires independently after 600 seconds.

The failed deploy retains the non-expiring mutex until an operator proves the remote state is quiescent and performs an exact-owner release.

A retry must repeat the drain, full integrity preflight, bookmark check, and exact candidate authorization.

If queue resume or verification fails, the script re-pauses queue delivery and
keeps the `queues_resuming` pre-acceptance marker with admission closed.

A retry recognizes that phase, idempotently resumes and verifies every Queue,
then removes the marker.

If the acceptance update or marker removal succeeded but its response was lost,
the running deploy re-verifies every Queue, repeats the idempotent acceptance
update, and repeats marker cleanup.

The cutover commit point is the durable `enabled = 0` update after successful
readback of all three resumed Queues.

If marker deletion or its readback fails before that accepted state is proven,
recovery first re-pauses and reads back every Queue to establish a known-safe
boundary.

It resumes again only when a later probe proves the gate is already absent.

After every Queue was verified open and acceptance was attempted, cleanup
failure does not re-pause delivery because the acceptance response may have been
lost after committing and deleting its durable marker.

That path repeats Queue verification and idempotent marker cleanup on the next
run.

If final confirmation still fails, keep the accepted v3 release and open Queues
in place and rerun the exact same release to repeat verification and cleanup.

Never roll back only the Worker, only the Driver image, or only D1.

The stored bookmark is not a routine rollback mechanism.

A D1 Time Travel restore permanently discards every D1 write made after that
bookmark and does not restore Durable Object storage.

Do not attempt a manual v2 recovery until a separate global maintenance mode
has stopped every production write, all post-bookmark writes have been
inventoried and reconciled, and a human has explicitly approved the data loss
and recovery plan.

Only then may an operator coordinate the matching v2 D1 state, Worker, and
Driver image, clear the reviewed stale DriverConnection Durable Object state,
verify the v2 rollout and data reconciliation, and reopen admission.

The deploy script deliberately provides no copyable Time Travel restore command.

## Step 9 - Final Worktree Check

```bash
git status --short
```

Acceptance:

- No unexpected tracked files changed.
- Build artifacts are ignored or intentionally left unstaged.
- No secrets or local environment files are staged.

## Real Deploy Safe Sequence

Before advancing a reviewed commit to production, run the repository's `Public
API non-production smoke` workflow against a deployed staging/preview base URL
ending in `/api/v1`. The workflow validates the live OpenAPI and creates an empty
Thread with the documented `userId`-only body. It hard-rejects `cloud.mosoo.ai`,
`try.mosoo.ai`, and `mosoo.ai`; never repoint it at production.

The normal production entry point is
`.github/workflows/deploy-try.yml`. A push to `deploy/try` in
`langgenius/mosoo` runs the simulation steps, invokes `just deploy`, and verifies
the public production endpoints. The workflow intentionally refuses to deploy
from a fork.

Configure the GitHub `try` Environment before the first release:

- Restrict deployment branches to `deploy/try`.
- Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as Environment secrets.
- Grant the deploy token only the production D1, Queue, Container, and Worker
  permissions used by the release script, and keep Worker runtime secrets in
  Cloudflare.
- Protect `deploy/try` from force-push and deletion, and restrict who may push
  it. Advance it only to a reviewed commit from `main`.

The workflow uses one `production` concurrency group and never cancels an
in-progress release because D1 migration, queue updates, and Worker publication
are not transactional.

### First `cloud.mosoo.ai` Release

Complete these one-time prerequisites before releasing the domain migration:

- Attach `cloud.mosoo.ai` as an additional Custom Domain on the
  `mosoo-web-prod` Worker and wait for its DNS record and certificate to become
  active. The normal deploy publishes the API Worker first, and its
  `cloud.mosoo.ai/api/*` route requires that hostname to exist already.
- Add `https://cloud.mosoo.ai/api/auth/callback/google` to the Google OAuth
  client. Keep the old callback during the compatibility window.
- Expect existing browser sessions to sign in again because host-scoped cookies
  do not move between subdomains.

Keep the `try.mosoo.ai` Web Custom Domain and API route during the compatibility
window. Web requests redirect to the new host; `/api/*` continues to execute on
the API Worker so existing CLI requests do not cross a redirect boundary.

For a manual release, run the real deploy only after all simulation steps above
pass.

```bash
git status --short --branch
just check
just deploy
```

Acceptance before running `just deploy`:

- The complete worktree and `apps/driver` submodule are clean; intended release
  changes must already be committed.
- `just check` exits `0` in the same shell shape used for deploy.
- All simulation steps above passed on this exact commit.

`just deploy` publishes production resources.

It runs the full repository check (`just check`), then `deploy:api`, then
`deploy:web`.

The API deploy (`apps/api/bin/deploy-prod.ts`) repeats the Driver build and API
dry-run, then acquires the production deploy mutex. Behind that lease it uses
the one-shot cutover above when any migration in the explicitly audited local
journal is pending or when the gate remains from an interrupted release.

The Web deploy then builds and publishes the Web Worker.

The API deploy enforces its clean release tree after local preflight and again
immediately before migration and Worker publication.

The Web deploy does not independently repeat that identity check, so the manual
worktree checks above remain required for the complete two-Worker release.

The preflights prevent deterministic build, bundle, config, and migration-chain
failures from surfacing after a remote mutation.

Cloudflare publication across D1, queues, the API Worker, and the Web Worker is
not transactional, so the protocol v3 gate deliberately fails closed after its
breaking migration.
If the final Web publish fails, keep the same clean release commit, diagnose the
provider failure, repeat Steps 6-7 (build and dry-run) manually, then rerun
`just deploy-web`. Do not rewrite or roll back an already-applied D1 migration.

## Real Deploy Acceptance

After a real production deploy, verify the public surface:

```bash
curl https://cloud.mosoo.ai/
curl https://cloud.mosoo.ai/api/health
curl https://cloud.mosoo.ai/api/graphql \
  -H 'content-type: application/json' \
  --data '{"query":"query { __typename }"}'
curl --head --max-redirs 0 \
  'https://try.mosoo.ai/domain-migration-check?source=runbook'
curl https://try.mosoo.ai/api/health
```

Acceptance:

- `/` returns HTTP 200.
- `/api/health` returns HTTP 200 and `{"name":"mosoo","ok":true}`.
- `/api/graphql` returns HTTP 200 and `{"data":{"__typename":"Query"}}`.
- The old Web URL returns HTTP 308 with the same path and query on
  `https://cloud.mosoo.ai`.
- The old `/api/health` URL returns HTTP 200 without redirecting.
- If local HTTPS probes resolve through the local TUN/fake-IP path, keep
  `--interface en0` and `--resolve` in the smoke commands.

## Stop Conditions

Stop before any real deploy when any item below is true:

- `just check` fails.
- Production D1 has pending migrations that were not reviewed.
- Migration `0014` is pending and its read-only loss inventory reports any candidate.
- The isolated local migration apply in Step 2 fails, or `pkgs/db/drizzle/**`
  rewrites SQL that production has already recorded.
- The API or Web dry-run fails.
- Production account identity is unclear.
- Any secret value appears in command output, tracked files, or staged diff.
