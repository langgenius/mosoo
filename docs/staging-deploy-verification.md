# Staging Deployment And Session Acceptance

Staging is a real Cloudflare deployment with synthetic test data. It exercises
the same production behavior with separate Workers, D1, R2, queues, and
Sandbox/Driver resources. Local development and dry-runs cannot establish its
runtime or recovery behavior. `MOSOO_ENVIRONMENT=production` in stage is
intentional; do not enable local authentication bypasses on the public host.

## Prepare The Candidate

1. Review the candidate diff and the `stage` sections of both
   `apps/api/wrangler.toml` and `apps/web/wrangler.toml`. Stage names, D1, buckets,
   queues, and the Web service binding must remain separate from production.
   The `deploy/try` branch/workflow and ordinary deploy recipes are production.
2. Run `just check` and record its result with the candidate SHA. Investigate
   failures and record any platform-specific limitation; a failed check is not
   a passing release gate. Production still requires its full runbook.
3. Follow the production runbook's build-input hygiene: no implicitly loaded
   app `.env*` files or exported `VITE_*` overrides, no hidden tracked changes,
   and no ignored source/public build inputs. Keep model keys in an explicitly
   selected, ignored credential file. Never upload the local provider file as
   global Worker secrets; provision only the dedicated test Project.
4. Inspect the stage migration ledger with the repository-pinned Wrangler:

   ```bash
   cd apps/api
   ../../node_modules/.bin/vp exec wrangler d1 migrations list DB --remote --env stage
   ```

   Compare the deployed schema and migration files. With pending SQL, first
   review it and replay the complete append-only chain in isolated local D1.
   A separate reviewed stage migration operation must finish before deployment;
   `just deploy-stage` deliberately does not apply it. Never reset stage as a
   shortcut when it holds delayed-continuation evidence.

5. Check stage's active test runs and recovery fixtures before updating
   Containers. Finish/checkpoint or deliberately cancel only the known test work
   that needs stopping. Record existing Worker versions and fixture IDs for
   recovery and regression comparison. Do not recycle production Sandboxes.

## Build And Publish

```bash
just stage-preflight
```

This builds the pinned Driver and Web, then dry-runs both Worker uploads with
`--env stage`. It publishes nothing and does not prove that tools or checkpoints
work. Commit and review the candidate before publishing:

```bash
just deploy-stage
```

The command refuses a dirty worktree, repeats the build/dry-run, then deploys API
and Web with the same source tag and a message containing the Driver revision.
It preserves existing secrets and does not apply D1 migrations. Capture command
output, deployed Worker version IDs, source/Driver SHAs, migration state, and
test results in a private release evidence directory. No credentials belong in
those records.

API and Web deploy sequentially. If Web fails after API succeeds, record the
partial deployment and repair it before acceptance. Do not claim an atomic
rollback; keep readers compatible with any newly admitted state. The same
source tag plus each observed Worker version identifies what was actually
tested, even when a later secret-only deployment changes the version ID.

## Verify The Deployment

- Read both deployed versions and confirm source/Driver provenance. Check API
  health, Web-to-API routing, normal login, Project isolation, and current
  OpenAPI. Health alone is insufficient.
- Wait for all four container applications to report ready before runtime
  acceptance. Verify their actual image digests and Driver bundle contents.
  A Worker update can reuse an existing identical image, so its version ID does
  not necessarily identify a new image tag. Keep model admission closed until
  the matched images are ready and previous Drivers have drained.
- Before removing the retired monetary-budget prototype, let previously budgeted
  turns finish and verify no active request remains. Keep applied migration 0016
  and its historical rows unchanged. New acceptance uses inexpensive BYOK models;
  no Mosoo monetary cap is enforced.
- Use a dedicated stage Project and its own application key. Production Project
  keys and encrypted credential rows do not transfer across databases. Provision
  authorized provider credentials through the ordinary credential service.
- Exercise the existing Thread API's compatible shape and IDs alongside the
  new admission and continuation behavior. Do not manufacture a naming-only
  migration to make the Session acceptance pass.
- For #582, execute actual Codex and Claude tools against a known CSV and verify
  report/chart/data content. Continue with prior private working files in the
  same Session, then verify forced-cold restoration and actual delayed
  continuation. Record wall-clock elapsed time separately from simulated expiry.
- Run ghFind against an exact public repository commit, fetched by tools or
  supplied as files. Validate analysis JSON, evidence JSON, and Markdown against
  the same material identity and verify idempotent retry does not start new work.
- Verify busy rejection, cancellation, checkpoint/recovery failure,
  expiry with readable history/artifacts, and cross-Project denial. Preserve the
  truthful outcome even when a failed turn has saved artifacts.

An empty Thread smoke, a model text response without tools, or a successful
backup request does not establish #582 acceptance. Cloud customer inventory,
verified shared-machine transition, compatible CLI/docs, and the production
release/notification evidence remain separate completion requirements.
