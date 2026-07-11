# Deployment Status Simplification

Status: approved on 2026-07-10.

## Problem

The App Overview exposes backend deployment phases as user-facing statuses and adds a Web-only
`superseded` pseudo-status for older successful runs. This mixes two different questions:

- Did this deployment run finish successfully?
- Is a successful result currently serving production traffic?

The result is a nine-label Activity vocabulary plus a five-step progress strip. The labels are more
detailed than the decisions users need to make, and `Superseded` can be mistaken for a canceled run
even though the persisted run outcome is `success`.

Mintlify's public Activity design provides the product reference: the list exposes coarse run
outcomes while build phases live in expanded deployment details. Mosoo does not yet expose a useful
deployment log, so detailed phases should remain internal until that complete diagnostic surface
exists.

## Decision

Keep the eight backend `AppDeploymentRunStatus` values unchanged for execution, retries,
observability, and future diagnostics. Project them at the Web boundary into three user-facing run
outcomes:

| Backend status                                                             | User-facing outcome |
| -------------------------------------------------------------------------- | ------------------- |
| `queued`, `preparing`, `building`, `submitting`, `submitted`, `activating` | `Deploying`         |
| `success`                                                                  | `Successful`        |
| `failed`                                                                   | `Failed`            |

Production availability is a separate environment state. A non-null deployment `liveUrl` is the
source of truth for `Production live`, regardless of whether the latest attempt is deploying or
failed. When there is no live URL, an active run shows `Production deploying`; a terminal failure
shows `Production unavailable`.

## User Experience

- Activity shows only `Deploying`, `Successful`, and `Failed`.
- All successful historical runs remain `Successful`; the UI does not show `Superseded`.
- The five-step Queued/Build/Submit/Activate/Live strip is removed.
- The header and environment section express production availability independently from the latest
  run outcome.
- If a redeploy fails while an older version is still serving, the page continues to show
  `Production live`. The failed attempt remains visible in Activity with its error details.
- If the first deployment fails, the environment is `Production unavailable` and the reserved URL
  may still be shown.
- The production preview uses `deployment.liveUrl` directly. A failed or active redeploy must not
  hide a still-live production preview.

## Architecture

Add a Web-local `DeploymentRunOutcome` projection and keep the shared contract, GraphQL schema, D1
schema, queue behavior, and executor transitions unchanged. Deployment view models expose the
projected outcome to UI components; backend phases do not cross the final presentation boundary.

Keep environment-state derivation pure and explicit so `liveUrl` takes precedence over the latest
attempt's outcome. Do not infer production availability from whether the latest run succeeded.

## Error Handling

- Run errors remain attached only to `Failed` Activity rows.
- A failed redeploy does not clear or downgrade a valid live environment.
- A missing live URL after a reported successful run is treated as unavailable UI state rather than
  inventing a fallback URL.

## Verification

- Add table-driven tests mapping all eight backend statuses to the three public outcomes.
- Test that multiple successful runs all remain `Successful`.
- Test environment precedence for live plus deploying, live plus failed, first deploy in progress,
  and first deploy failed.
- Run the Web package tests and typecheck.
- Visually inspect the fixture-backed deployment preview at desktop and narrow widths.

## Non-goals

- No GraphQL or D1 schema change.
- No production migration.
- No change to retry, queue, executor, or Cloudflare deployment semantics.
- No deployment-log or expandable phase-detail UI in this change.
