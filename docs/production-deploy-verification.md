# Production Deploy Verification

This runbook simulates `just deploy` without publishing Workers or mutating
production D1. It is the required preflight before a production deploy.

## Rules

- Do not put Cloudflare account IDs, API tokens, secret values, or private keys
  in tracked files.
- Set `CLOUDFLARE_ACCOUNT_ID` only in the shell that runs the check.
- Remove app-local `.env*` files that Wrangler or Vite would load implicitly,
  and unset every `VITE_*` process variable before a production build.
- Export the production account id, the last approved production commit, and
  the exact release commit in the current shell. The DB base is a trust input;
  do not substitute an arbitrary moving branch name:

```bash
export CLOUDFLARE_ACCOUNT_ID="<production-account-id>"
export DB_MIGRATION_BASE_SHA="<last-approved-production-commit>"
export DB_MIGRATION_HEAD_SHA="$(git rev-parse HEAD)"
```

- During simulation, do not run:

```bash
just deploy
just deploy-api
just deploy-web
bun run deploy
bun run deploy:api
bun run deploy:web
bun run deploy:web:publish
```

Those commands publish or mutate production resources.

## Step 0 - Confirm The Worktree

```bash
git status --short --branch
```

Acceptance:

- Current branch is the intended release branch or `main`.
- The whole repository, including `apps/driver`, has no staged, unstaged, or
  untracked changes. Production deploy refuses a dirty worktree or submodule.
- No tracked path uses Git `assume-unchanged` or `skip-worktree`, and no ignored
  file exists under the Web `src` or `public` build-input directories.
- `DB_MIGRATION_HEAD_SHA` resolves to the checked-out `HEAD`, and
  `DB_MIGRATION_BASE_SHA` is its ancestor.

## Step 1 - Run The Full Repository Gate

```bash
just check
```

Acceptance:

- Command exits `0`.
- Formatting, lint, typecheck, tests, and generated output checks pass.

## Step 2 - Confirm Production D1 Migration State

First prove the checked-out schema, migration journal, snapshots, and SQL are
current and safe. This runs Drizzle against a temporary copy and does not touch
the repository database state or any remote resource:

```bash
just db-migrations-check
bun run --filter @mosoo/db db:check:deploy
```

Then execute the complete migration chain against an isolated local D1 database:

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

- The local migration contract, deploy-grade trusted-range check, and isolated
  full-chain apply exit `0`. The trusted-range check proves append-only history
  from the approved production base to the exact clean checkout; the isolated
  apply proves that the accepted SQL chain actually executes before production.
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
- `channel-final-delivery` exists.
- `channel-final-delivery-dlq` exists.

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
the channel-final-delivery queues.

```bash
cd apps/api
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  ../../node_modules/.bin/vp exec wrangler deploy --env prod --minify --dry-run
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
  ../../node_modules/.bin/vp exec wrangler deploy --env prod --dry-run
cd ../..
```

Acceptance:

- Command exits `0`.
- Wrangler validates the `prod` environment.
- No Worker is deployed.

## Step 8 - Confirm The Production D1 Contract

```bash
just db-migrations-check
rg -n "wipeProdD1|Wiping prod D1|database delete|database create" apps/api/bin/deploy-prod*.ts
```

Acceptance:

- The migration check verifies the journal/snapshots, proves the schema has no
  ungenerated change, and accepts only additive SQL in the normal release lane.
- The `rg` command returns no matches.
- The deploy entry/orchestrator checks the trusted clean checkout before running
  the Driver build, validates the production Worker bundle, applies the complete
  D1 migration chain to an isolated local database, then repeats the clean
  append-only migration contract before applying pending remote D1 migrations.
  It deploys the API Worker only after the post-apply table check and queue setup.

## Step 9 - Final Worktree Check

```bash
git status --short
```

Acceptance:

- No unexpected tracked files changed.
- Build artifacts are ignored or intentionally left unstaged.
- No secrets or local environment files are staged.

## Real Deploy Safe Sequence

Run the real deploy only after all simulation steps above pass.

```bash
git status --short --branch
just check
bun run --filter @mosoo/db db:check:deploy
just deploy
```

Acceptance before running `just deploy`:

- The complete worktree and `apps/driver` submodule are clean; intended release
  changes must already be committed.
- The explicit migration head equals the checked-out commit and the approved
  migration base is its ancestor.
- `just check` exits `0` in the same shell shape used for deploy.

`just deploy` publishes production resources. It runs the full repository check,
then checks the clean release worktree, builds the Web assets, and dry-runs the
Web upload before the first API remote mutation. The API deploy checks the
trusted clean checkout, builds the Driver, dry-runs the production Worker,
applies the complete D1 migration chain to an isolated local database, rechecks
the release inputs and clean append-only migration contract, applies pending
remote D1 migrations, verifies expected tables, ensures the
channel-final-delivery queues, and deploys the API Worker. Only then does it
recheck the clean worktree and publish the already-preflighted Web Worker.

The preflights prevent deterministic build, bundle, config, and migration-chain
failures from surfacing after a remote mutation. Cloudflare publication across
D1, queues, the API Worker, and the Web Worker is not transactional: a provider,
permission, or network failure can still leave an earlier remote step published.
If the final Web publish fails, keep the same clean release commit, diagnose the
provider failure, then rerun `just deploy-web` so its clean-check, build, and
dry-run preflight repeat before the retry. Do not rewrite or roll back an
already-applied D1 migration.

## Real Deploy Acceptance

After a real production deploy, verify the public surface:

```bash
curl https://try.mosoo.ai/
curl https://try.mosoo.ai/api/health
curl https://try.mosoo.ai/api/graphql \
  -H 'content-type: application/json' \
  --data '{"query":"query { __typename }"}'
```

Acceptance:

- `/` returns HTTP 200.
- `/api/health` returns HTTP 200 and `{"name":"mosoo","ok":true}`.
- `/api/graphql` returns HTTP 200 and `{"data":{"__typename":"Query"}}`.
- If local HTTPS probes resolve through the local TUN/fake-IP path, keep
  `--interface en0` and `--resolve` in the smoke commands.

## Stop Conditions

Stop before any real deploy when any item below is true:

- `just check` fails.
- Production D1 has pending migrations that were not reviewed.
- `just db-migrations-check` rejects the migration chain or schema snapshot.
- The API or Web dry-run fails.
- Production account identity is unclear.
- Any secret value appears in command output, tracked files, or staged diff.
