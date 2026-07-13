# Production Deploy Verification

This runbook simulates `just deploy` without publishing Workers or mutating
production D1. It is the required preflight before a production deploy.

## Rules

- Do not put Cloudflare account IDs, API tokens, secret values, or private keys
  in tracked files.
- Set `CLOUDFLARE_ACCOUNT_ID` only in the shell that runs the check.
- Remove app-local `.env*` files that Wrangler or Vite would load implicitly,
  and unset every `VITE_*` process variable before a production build.
- Export the production account id in the current shell:

```bash
export CLOUDFLARE_ACCOUNT_ID="<production-account-id>"
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
  untracked changes. The deploy script does not check this itself — it ships
  whatever is on disk — so this manual check is the only worktree gate.
- No tracked path uses Git `assume-unchanged` or `skip-worktree`, and no ignored
  file exists under the Web `src` or `public` build-input directories.

## Step 1 - Run The Full Repository Gate

```bash
just check
```

Acceptance:

- Command exits `0`.
- Formatting, lint, typecheck, tests, and generated output checks pass.

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
  migrations by filename: a rewritten `0000_baseline.sql` is silently skipped
  by the production database that already recorded it.
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
rg -n "wipeProdD1|Wiping prod D1|database delete|database create" apps/api/bin/deploy-prod*.ts
```

Acceptance:

- The `rg` command returns no matches.
- `apps/api/bin/deploy-prod.ts` still performs, in order: apply pending remote
  D1 migrations (its first remote mutation), verify every baseline table exists
  in prod (the DEPLOY-D1-001 guard against a rewritten baseline being silently
  skipped), ensure the channel-final-delivery queues, build the Driver, then
  deploy the API Worker. The script performs no clean-worktree check and no
  dry-run of its own; Steps 0-7 of this runbook are the only preflight.

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
just deploy
```

Acceptance before running `just deploy`:

- The complete worktree and `apps/driver` submodule are clean; intended release
  changes must already be committed.
- `just check` exits `0` in the same shell shape used for deploy.
- All simulation steps above passed on this exact commit.

`just deploy` publishes production resources. It runs the full repository check
(`just check`), then `deploy:api`, then `deploy:web`. The API deploy
(`apps/api/bin/deploy-prod.ts`) applies pending remote D1 migrations as its
very first remote action — before any build or bundle validation — then runs
the baseline schema guard, ensures the channel-final-delivery queues, builds
the Driver, and deploys the API Worker. The Web deploy then builds and
publishes the Web Worker. Neither deploy performs its own worktree check or
dry-run; that is exactly why the simulation steps above are required.

The preflights prevent deterministic build, bundle, config, and migration-chain
failures from surfacing after a remote mutation. Cloudflare publication across
D1, queues, the API Worker, and the Web Worker is not transactional: a provider,
permission, or network failure can still leave an earlier remote step published.
If the final Web publish fails, keep the same clean release commit, diagnose the
provider failure, repeat Steps 6-7 (build and dry-run) manually, then rerun
`just deploy-web`. Do not rewrite or roll back an already-applied D1 migration.

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
- The isolated local migration apply in Step 2 fails, or `pkgs/db/drizzle/**`
  rewrites SQL that production has already recorded.
- The API or Web dry-run fails.
- Production account identity is unclear.
- Any secret value appears in command output, tracked files, or staged diff.
