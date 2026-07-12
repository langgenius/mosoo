# App Vibe App

Status: active contract for the vibesdk-backed app lifecycle. Supersedes the
retired GitHub-repository `App Deployment` contract.

## Product Contract

A **Vibe App** is the App-owned external web application that Mosoo builds,
previews, and publishes through a Mosoo-operated
[Cloudflare VibeSDK](https://github.com/cloudflare/vibesdk) instance.

The user-facing loop is:

1. The owner describes the app in natural language from App Overview.
2. Mosoo creates one VibeSDK app for the App and generation starts
   immediately. The VibeSDK builder plans, writes, and validates the code.
3. While generating and after, the owner opens the live **preview URL** to try
   the app in a sandbox.
4. The owner iterates by sending follow-up prompts (bug reports, new
   features). This is also the debug loop: describe what is wrong, the builder
   fixes it, the preview refreshes.
5. The owner publishes. The app deploys to Workers for Platforms on the
   VibeSDK instance's account and gets its stable **production URL**.
6. The owner can mint a short-lived **git clone URL** to export the source.
7. Delete removes the VibeSDK app and the Mosoo binding. The VibeSDK
   instance does not tear down already-published deployments; they may keep
   serving until platform-side cleanup.

One App owns zero or one Vibe App. Access is App-owner-only, using the same
ownership checks as every other App resource.

## Boundary

- The Vibe App is not Agent runtime. Agents, Threads, Sessions, and
  `AgentDeploymentVersion` are unrelated to it.
- Mosoo's control plane holds no build state machine: the VibeSDK instance is
  the source of truth for generation, preview, and publish state. Mosoo reads
  it live and stores only the binding.
- Users do not bring their own Cloudflare account or VibeSDK credentials. The
  API Worker holds one platform API key; tenant isolation is Mosoo's App
  ownership check.
- Injecting Mosoo Agent capabilities into a published Vibe App (the retired
  `.mosoo.toml [[agents]]` wedge) is out of scope and returns later as an
  explicit contract.

## Architecture

```text
Web console ── GraphQL ──> API Worker ── @cf-vibesdk/sdk ──> VibeSDK instance
                              │   HTTP status reads +            (Mosoo-operated:
                              │   short-lived WS commands         containers preview,
                              └── D1: app_vibe_app binding        dispatch-namespace publish)
```

- `@cf-vibesdk/sdk` is the only integration surface, wrapped by one gateway
  module. Commands (follow-up prompt, publish, refresh preview) connect the
  session WebSocket, send one message, confirm delivery with a
  `get_conversation_state` barrier, and close. State reads use the SDK's HTTP
  app endpoint. No run ledger and no persisted status machine.
- The VibeSDK per-app agent keeps working autonomously after Mosoo
  disconnects, so command mutations return in seconds and the console polls
  the status query while work is in flight.
- Create is the exception: the SDK's build call streams the whole blueprint
  before returning, which measures 60s+ on a real instance — past any held
  request budget. `createAppVibeApp` therefore persists the binding with a
  null `vibe_app_id`, enqueues one `vibe_app_create` command, and returns a
  `creating` status immediately. The queue consumer runs the build with a
  generous budget, attaches the remote app id, and on any failure deletes the
  binding so the owner can retry cleanly; if the owner deletes the binding
  mid-build, the consumer deletes the freshly built remote app instead. The
  build is not idempotent, so the command never retries.

## Data Model

`app_vibe_app`:

- `id`
- `app_id` (unique)
- `vibe_app_id` — the app/agent id on the VibeSDK instance; null while the
  queued create is still building
- `created_at`

All lifecycle state (generation phase, preview URL, production URL, title) is
read live from the VibeSDK instance and never persisted.

## API Shape

GraphQL, App-scoped, owner-only:

- `createAppVibeApp(input: { appId, prompt }): AppVibeApp!` — one per App;
  returns `status: creating` immediately and queues the build; fails with
  `VIBE_APP_EXISTS` when a binding already exists.
- `sendAppVibeAppPrompt(input: { appId, prompt }): OperationResult!`
- `publishAppVibeApp(input: { appId }): OperationResult!`
- `refreshAppVibeAppPreview(input: { appId }): OperationResult!`
- `createAppVibeAppCloneUrl(input: { appId }): AppVibeAppCloneUrl!` —
  `{ cloneUrl, expiresAt }`, treat the URL as a secret.
- `deleteAppVibeApp(input: { appId }): OperationResult!` — deletes the remote
  VibeSDK app first; the binding row is removed only after remote deletion
  succeeds (a missing remote app counts as deleted).
- `appVibeApp(appId: ULID!): AppVibeApp` — null when the App has no Vibe App.
  Reads tolerate a broken VibeSDK configuration: with no binding they stay
  null; with a binding they fail with `VIBE_APP_UNCONFIGURED`.
- `appVibeAppEnabled: Boolean!` — whether this deployment has a usable VibeSDK
  configuration; the console hides the create surface when false.

`AppVibeApp`:

- `id`, `appId`, `vibeAppId` (null while `creating`)
- `status`: `creating` (queued build not yet attached) | `generating` |
  `ready` (VibeSDK `generating`/`completed`)
- `title`: VibeSDK app title, null until known
- `previewUrl`: sandbox preview, null until first preview deploy
- `productionUrl`: Workers-for-Platforms URL, null until first publish
- `lastPublishedAt`: when the last publish completed, null before the first —
  the console uses its change to show publish completion
- `createdAt`, `updatedAt`

## Configuration

API Worker bindings:

- `VIBESDK_BASE_URL` (secret-provisioned) — the VibeSDK instance origin.
- `VIBESDK_API_KEY` (secret) — platform API key, exchanged by the SDK for
  short-lived JWTs.

Both are operator-supplied through the worker secrets contract.

Missing configuration fails the Vibe App command surfaces loudly with
`VIBE_APP_UNCONFIGURED`; nothing else in the product depends on it.

## Failure Model

- `VIBE_APP_UNCONFIGURED` — VibeSDK bindings missing or partial. The status
  query stays null (feature dormant) only while the App also has no binding.
- `VIBE_APP_EXISTS` — create called while a binding exists.
- `NOT_FOUND` — command called with no binding. Delete is the exception: it
  is idempotent and returns ok with no binding.
- `VALIDATION_FAILED` — command called while the binding is still `creating`
  (and empty prompts).
- `VIBE_APP_UNAVAILABLE` — the VibeSDK instance rejected or failed a call; the
  message carries the upstream detail. Command mutations are safe to retry.

Known bounded gaps: a create that fails before the blueprint stream returns
compensates asynchronously (and can leave an orphan remote app if the isolate
dies first), and the SDK can leak one WebSocket when a session closes during
its ticket fetch — both are invisible to users and cleaned up by
platform-side maintenance, not product state.

## Skip For Now

- Passing App-scoped provider credentials (BYOK) into builds.
- Driving the Vibe App from Mosoo Agents/Threads as a control-plane tool.
- Surfacing per-phase timelines, terminal logs, and runtime errors in the
  console (VibeSDK repairs most of these autonomously; follow-up prompts cover
  the rest).
- Multiple Vibe Apps per App, forking, visibility/star/favorite social
  surfaces, GitHub export, and image attachments on prompts.
