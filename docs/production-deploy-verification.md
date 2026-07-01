# Production Deploy Verification

This runbook simulates `just deploy` without publishing Workers or mutating
production D1. It is the required preflight before a production deploy.

## Rules

- Do not put Cloudflare account IDs, API tokens, secret values, or private keys
  in tracked files.
- Set `CLOUDFLARE_ACCOUNT_ID` only in the shell that runs the check.
- Use Homebrew Node for this repository:

```bash
export PATH="/opt/homebrew/bin:$PATH"
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
- No unexpected staged or unstaged tracked changes exist.
- Known local-only dirty state is identified and not staged.

## Step 1 - Run The Full Repository Gate

```bash
PATH=/opt/homebrew/bin:$PATH just check
```

Acceptance:

- Command exits `0`.
- Formatting, lint, typecheck, tests, and generated output checks pass.

## Step 2 - Confirm Production D1 Migration State

This is read-only. It must not apply migrations.

```bash
cd apps/api
PATH=/opt/homebrew/bin:$PATH CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  ../../node_modules/.bin/vp exec wrangler d1 migrations list DB --remote --env prod
cd ../..
```

Acceptance:

- For a no-op schema release, output says no migrations need to apply.
- If pending migrations are listed, stop and review the exact SQL before any
  real deploy.
- Pending migrations may be accepted only when they are additive or explicitly
  approved for production.

## Step 3 - Confirm Production Queues Exist

This is read-only. It must not create queues.

```bash
cd apps/api
PATH=/opt/homebrew/bin:$PATH CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
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
PATH=/opt/homebrew/bin:$PATH ./node_modules/.bin/vp run --filter agent-driver build
```

Acceptance:

- Command exits `0`.
- Driver bundle is produced without TypeScript or bundling errors.

## Step 5 - Dry-Run The API Worker Upload

This validates the API Worker bundle without publishing it. It does not run the
full API deploy script because the real script applies D1 migrations and ensures
queues.

```bash
cd apps/api
PATH=/opt/homebrew/bin:$PATH CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
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
PATH=/opt/homebrew/bin:$PATH ./node_modules/.bin/vp run --filter @mosoo/web build
```

Acceptance:

- Command exits `0`.
- Blog build succeeds.
- Web build succeeds.
- `apps/web/dist` is produced.

## Step 7 - Dry-Run The Web Worker Upload

```bash
cd apps/web
PATH=/opt/homebrew/bin:$PATH CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  ../../node_modules/.bin/vp exec wrangler deploy --env prod --dry-run
cd ../..
```

Acceptance:

- Command exits `0`.
- Wrangler validates the `prod` environment.
- No Worker is deployed.

## Step 8 - Confirm No Production D1 Reset Path Exists

```bash
rg -n "wipeProdD1|Wiping prod D1|d1.*execute.*--file|database delete|database create" apps/api/bin/deploy-prod.ts
rg -n "DROP TABLE|TRUNCATE|DELETE FROM" pkgs/db/drizzle
```

Acceptance:

- The first command returns no matches.
- The second command returns no matches unless the destructive SQL was
  explicitly approved with a backup and rollback plan.
- `apps/api/bin/deploy-prod.ts` only applies pending remote D1 migrations before
  deploying the API Worker.

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
PATH=/opt/homebrew/bin:$PATH just check
PATH=/opt/homebrew/bin:$PATH CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" just deploy
```

Acceptance before running `just deploy`:

- The worktree has no unexpected runtime changes.
- `apps/driver` is clean unless the driver change is intentionally part of the
  production release.
- Documentation-only staged changes are acceptable, but runtime dirty files are
  not.
- `just check` exits `0` in the same shell shape used for deploy.

`just deploy` publishes production resources. It runs the full repository check,
then deploys API and Web. The API deploy applies pending remote D1 migrations,
ensures required queues, builds the driver, and deploys the API Worker. The Web
deploy builds the Web and Blog assets, then deploys the Web Worker.

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
- Any migration contains unapproved destructive SQL.
- The API or Web dry-run fails.
- Production account identity is unclear.
- Any secret value appears in command output, tracked files, or staged diff.
