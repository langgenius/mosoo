# Vibe App Lifecycle Design

Status: implementation plan for the vibesdk pivot.

## Motivation

The shipped App Deployment path (public GitHub repo → in-sandbox build → publish
as a plain Cloudflare Worker/Pages project with a platform `CLOUDFLARE_API_TOKEN`)
duplicates an entire deployment platform inside the Mosoo API: repository
detection, wrangler config generation, Pages/Workers upload clients, an
eight-state run machine, queue dispatch, and capability-URL minting. It only
covers code that already lives in a public GitHub repository, so it never served
the product's actual loop: code that a user brings in conversation or that an
agent generates.

[Cloudflare VibeSDK](https://github.com/cloudflare/vibesdk) is an open-source
vibe-coding platform that already owns that loop end to end: prompt-driven app
generation, live sandbox previews, iterative debugging, and one-command publish
to Workers for Platforms dispatch namespaces. It ships an official client SDK,
[`@cf-vibesdk/sdk`](https://www.npmjs.com/package/@cf-vibesdk/sdk), for headless
platform automation.

This change deletes the GitHub deployment vertical and replaces it with a thin
client of a Mosoo-operated VibeSDK instance.

## Product Contract

New noun: **Vibe App** — the App-owned external web application built and
hosted through the VibeSDK backend. It replaces the retired GitHub `Deployment`
noun everywhere.

- An App owns zero or one Vibe App. Owner-only access, same App ownership
  checks as every other App resource.
- Lifecycle:
  1. **Create**: the owner submits a natural-language prompt from App Overview.
     Mosoo creates a VibeSDK app and generation starts immediately.
  2. **Develop / debug**: generation state and the live sandbox **preview URL**
     are polled from the VibeSDK instance. The owner iterates by sending
     follow-up prompts (fix requests, new features); VibeSDK's builder applies
     them and refreshes the preview. A stale preview can be redeployed on demand.
  3. **Publish**: one action deploys the built app to Workers for Platforms.
     The **production URL** appears on App Overview when live.
  4. **Export**: the owner can mint a short-lived git clone URL to take the
     source anywhere.
  5. **Delete**: removes the VibeSDK app and the Mosoo binding.
- The Vibe App is not Agent runtime. Agents, Threads, and Sessions are
  untouched. (Re-binding deployed apps to Agents via injected capability URLs
  was removed with the GitHub path and returns later as an explicit contract.)

## Architecture

```text
Mosoo Web ── GraphQL ──> Mosoo API Worker ── @cf-vibesdk/sdk ──> VibeSDK instance
                              │  (HTTP status reads,                (own CF account infra:
                              │   short-lived WS commands)           containers, dispatch ns,
                              └── D1: app_vibe_app binding           R2 templates, D1)
```

Key decisions, in force-ranked order:

1. **The VibeSDK instance is the source of truth for build/deploy state.** Its
   per-app agent Durable Object keeps generating, previewing, and deploying
   autonomously after Mosoo disconnects. Mosoo therefore stores **no status
   machine, no run history, and needs no queue** — it polls
   `client.apps.get(id)` for `generating|completed`, `previewUrl`, and
   `cloudflareUrl`.
2. **D1 stores only the binding**: `app_vibe_app(id, app_id UNIQUE,
   vibe_app_id, created_at)`.
3. **Commands are short-lived**: create uses the SDK build call; iterate /
   publish / preview-refresh open the session WebSocket, send one command, and
   close. Every mutation completes in seconds; completion is observed by
   polling.
4. **One platform identity**: the API Worker authenticates to the VibeSDK
   instance with `VIBESDK_API_KEY` (exchanged for a short-lived JWT by the SDK).
   All VibeSDK apps belong to that platform account; tenant isolation stays in
   Mosoo's App ownership checks, mirroring the retired Mosoo-managed-credentials
   model.
5. **Fail fast, no fallback**: missing `VIBESDK_BASE_URL` / `VIBESDK_API_KEY`
   fails the feature loudly at first use; an unreachable instance surfaces as a
   GraphQL error, and the console shows a retryable error state.

## Engineering Shape

- `apps/api/src/modules/apps/application/vibesdk-gateway.ts` — the only file
  that imports `@cf-vibesdk/sdk`. Exposes a small `VibesdkGateway` interface
  (`createApp`, `getApp`, `sendPrompt`, `publish`, `refreshPreview`,
  `createCloneUrl`, `deleteApp`) with normalized errors. Tests inject a fake.
- `apps/api/src/modules/apps/application/vibe-app.service.ts` — ownership
  checks, binding row lifecycle, DTO mapping.
- GraphQL (replaces the four deployment fields and `AppOverview.deployment`):
  - `createAppVibeApp(input { appId, prompt }): AppVibeApp!`
  - `sendAppVibeAppPrompt(input { appId, prompt }): OperationResult!`
  - `publishAppVibeApp(input { appId }): OperationResult!`
  - `refreshAppVibeAppPreview(input { appId }): OperationResult!`
  - `createAppVibeAppCloneUrl(input { appId }): AppVibeAppCloneUrl!`
  - `deleteAppVibeApp(input { appId }): OperationResult!`
  - `appVibeApp(appId: ULID!): AppVibeApp` (null when absent; live-merges
    VibeSDK status: `status: GENERATING|READY`, `previewUrl`, `productionUrl`,
    `title`)
- Web: `routes/app-overview/vibe/**` replaces `routes/app-overview/deploy/**`.
  Empty state = prompt box; active state = status badge, preview link,
  follow-up prompt box, publish button, production URL, clone URL, delete.
  Poll while `GENERATING` (2.5s, same cadence the deploy console used).
- Behavior type is `phasic` (the current tagged VibeSDK release lane).

## Deletion Scope (the other half of this change)

Everything tagged exclusive to the GitHub deploy path goes: the five
`app-deployment-*` application files and lifecycle domain file, the bound-agent
capability surface (`app-agent-capability`, `app-agent-bound-*`, the
`/api/v1/bound/:token` route), queue command kind + enqueue/policy/processor
branches, deployment GraphQL types/fields/resolvers, `app_deployment` +
`app_deployment_run` tables and their id/contract types, the whole web deploy
console and its data layer, deployment tests, `docs/prd/app-deployment.md`, the
`cloudflare` npm dependency, and the `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ZONE_ID` / `MOSOO_APP_DEPLOYMENT_DOMAIN` bindings.
`CLOUDFLARE_ACCOUNT_ID` stays (R2 sandbox state mounts use it).

DB note: the repository's current lane regenerates the single Drizzle baseline
(`just db-regen`); this change removes the two deployment tables and adds
`app_vibe_app` in that baseline. Production operators must treat the next
deploy as a schema reset for those tables (alpha, no compatibility promise).

## Test Plan

- **Gateway matrix** (`vibe-app-gateway.test.ts`): a fake VibeSDK server
  (in-process HTTP + WebSocket) covering auth exchange, each command × {ok,
  unauthorized, server error, connection drop}, and the status-mapping matrix
  {generating, completed} × {previewUrl ∅/set} × {cloudflareUrl ∅/set}.
- **Service lifecycle matrix** (`vibe-app-service.test.ts`): create
  {fresh, duplicate, unowned app, missing app}, command-without-binding,
  delete {ok, remote-already-gone, remote-failure keeps binding}, clone URL.
- **Web projection matrix**: VibeSDK states → console badge/action states.
- Keystone-first: the mapping and lifecycle tests land before/with the
  implementation and drive it.

## References

- VibeSDK repo analysis (agent DO autonomy, dispatch deploy, preview capture):
  cloudflare/vibesdk @ 1023f68.
- `@cf-vibesdk/sdk@0.1.5` README + bundled types (the full client surface).
- Retired contract: `docs/prd/app-deployment.md` (deleted by this change).
