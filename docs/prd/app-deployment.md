# App Deployment

Status: active and shipped.

This document defines the shipped App-owned `Deployment` resource. Deployment publishes an
external Web artifact and public URL from a public GitHub repository. It is not Agent runtime, an
App-level API endpoint, or an Agent `DeploymentVersion`.

## Product Contract

The user-facing loop is:

1. The user configures one public GitHub repository URL on an App.
2. The user starts a Deploy action.
3. Mosoo detects the repository shape, app type, and start/build commands from
   repository files.
4. If the user wants to override detection, the repository may contain a root
   `.mosoo.toml`.
5. Mosoo validates the detected or user-defined deployment plan and
   creates a Cloudflare deployment plan.
6. Mosoo deploys to Mosoo's Cloudflare platform account, using Cloudflare Pages
   or Cloudflare Workers.
7. Mosoo stores the URL returned by the successful deploy. Workers use the
   planned Mosoo-owned host; Pages may temporarily expose its `pages.dev` URL
   while custom-domain activation is still pending.

The current product supports one active Deployment per App and a Mosoo-managed
domain/URL. Multiple deployment targets, user-supplied custom domains, branch
previews, and automatic redeploys are later.

## Current Boundary

Deployment is part of the current App boundary while remaining separate from Agent runtime:

- `App` remains the business/resource boundary.
- `Deployment` is the App-owned external Web artifact.
- Agent design, Agent runtime, Agent Sessions, and `AgentDeploymentVersion`
  remain unrelated.
- `DeploymentRun` is one deployment attempt for a Deployment.

Do not reuse `agent_deployment_version` for Cloudflare deployments.

## Cloudflare Account Boundary

Production deploys target Mosoo's Cloudflare account. This is a paid platform
capability because Mosoo owns the Cloudflare resources, billing, quotas, abuse
controls, and final customer-facing subdomain.

The planned public URL is Mosoo-owned and derived from the App ID:

```text
https://app-<lowercase-app-id>.<MOSOO_APP_DEPLOYMENT_DOMAIN>
```

The exact subdomain policy can change, but the account boundary does not: users
do not bring their own Cloudflare account in the current product. Until a Pages
custom domain becomes active, `liveUrl` can be that Mosoo account's Cloudflare
`pages.dev` deployment URL while `plannedUrl` remains the App-derived host.

## Technology Stack

Use the existing Mosoo stack:

- D1 for Deployment and DeploymentRun metadata.
- Queues for asynchronous deployment work.
- Existing App ownership checks for access control.
- Mosoo platform Cloudflare credentials stored outside user-controlled App
  configuration.
- Existing Sandbox/Container execution boundary for cloning and building public
  GitHub repositories.
- Official Cloudflare TypeScript SDK package `cloudflare` for Cloudflare
  management APIs.
- Wrangler for Mosoo's own local development, type generation, generated config
  validation, and controlled Pages artifact upload. The authenticated Pages
  command runs in a separate deploy sandbox after repository-owned build code
  has finished; it does not execute inside the untrusted repository build.

External surfaces:

- GitHub REST API for repository identity/default branch and pinned commit
  resolution; the isolated builder clones that commit and scans its local snapshot.
- Cloudflare TypeScript SDK for Pages project/domain/read/delete operations and
  Workers script/version/deployment APIs; controlled Wrangler for the Pages
  artifact upload itself.
- Optional root `.mosoo.toml` as the user override contract.
- Generated Wrangler config as an internal deployment artifact.

## Repository Detection

Detection reads public GitHub facts first, then clones the pinned commit only if
the repository passes the cheap checks. The default path is automatic detection;
`.mosoo.toml` only overrides detection when present at the repository root.

GitHub facts:

- `owner`, `repo`, visibility, default branch, clone URL.
- default branch commit SHA.
- a pinned default-branch commit cloned into the isolated build Sandbox;
- root files and tree shape read from that local snapshot.

Rule precedence:

1. Root `.mosoo.toml` overrides Mosoo detection for app type, root, install
   command, build command, output directory, and Worker entry.
2. Pages/Worker edge files such as `functions/`, `_worker.js`, or `_routes.json`
   are validation signals, not authority.
3. `package.json`, lockfiles, root `index.html`, and output directories are
   build-shape signals.
4. Missing or inconsistent detection stops with `deployment_config_required`.

User-provided `wrangler.toml`, `wrangler.json`, and `wrangler.jsonc` may be read
as hints, but Mosoo must not trust them as deploy authority. Mosoo generates the
final Wrangler configuration and strips fields users should not control.

The detection result is a `DeploymentPlan`:

```ts
interface DeploymentPlan {
  agentBindings: Array<{ env: string; expose: "public_thread"; name: string }>;
  rootDir: string;
  packageManager: "pnpm" | "npm" | "yarn" | "bun" | "none";
  installCommand: string | null;
  buildCommand: string | null;
  outputDir: string | null;
  targetKind: "cloudflare_pages" | "cloudflare_worker";
  targetMode: "static_assets" | "worker_module" | "worker_with_assets";
  mosooConfigPath: ".mosoo.toml" | null;
  generatedWranglerConfig: string;
  routesFallback: string | null;
  workerEntry: string | null;
  warnings: string[];
}
```

`worker_with_assets` remains a reserved type value; the current detector emits
`static_assets` for Pages and `worker_module` for Workers.

Do not infer D1, R2, KV, Queues, Durable Objects, user-supplied custom domains,
or secrets from package dependencies. Those require explicit user configuration.

## Cloudflare Support And Detector Baseline

Cloudflare can run more shapes than Mosoo currently detects:

- Pages handles static sites and static framework output.
- Workers handles request-time logic and can also serve static assets.
- Pages Functions can run dynamic code, but should not be a first-class branch
  in the MVP.

The detector is a whitelist, not a full Cloudflare framework adapter. If a
repository needs migration, adapter installation, framework-specific SSR
configuration, bindings, or secrets, return `deployment_config_required`.

Current detector table:

| Repository signal                                                 | Target  | Plan                                               |
| ----------------------------------------------------------------- | ------- | -------------------------------------------------- |
| `.mosoo.toml` with `type = "static"`                              | Pages   | Use declared root, build, and output.              |
| `.mosoo.toml` with `type = "worker"`                              | Workers | Use declared root, build, and Worker entry.        |
| `wrangler.toml`, `wrangler.json`, or `wrangler.jsonc` with `main` | Workers | Read as hints only; generate Mosoo config.         |
| Root `index.html` with no package build                           | Pages   | No install or build; output is root.               |
| Vite static app                                                   | Pages   | Run package build; output `dist`.                  |
| Astro static output                                               | Pages   | Run package build; output `dist`.                  |
| Docusaurus                                                        | Pages   | Run package build; output `build`.                 |
| Next.js static export                                             | Pages   | Only when static export is explicit; output `out`. |
| Hono or plain Worker with explicit entry                          | Workers | Build/package Worker entry.                        |

Unsupported in the MVP:

- Next.js SSR, ISR, or middleware.
- Nuxt, SvelteKit, Remix, React Router, or other full-stack SSR modes.
- Pages Functions as the primary target.
- Monorepo root guessing.
- Python/FastAPI or non-JavaScript Workers.
- Automatic Cloudflare adapter installation.
- Automatic D1, R2, KV, Queues, Durable Objects, or secret provisioning.

## Override Config Contract

`.mosoo.toml` is optional. It is the only user-authored deployment override file
in the current contract. It describes application intent, not raw Cloudflare
infrastructure. If it is absent, Mosoo detects the app type and commands from the
repository.

Example:

```toml
name = "my-app"
type = "static"
root = "."

[build]
install = "pnpm install --frozen-lockfile"
command = "pnpm build"
output = "dist"

[routes]
fallback = "index.html"
```

Allowed current fields:

- `name`
- `schema`: when present, must be integer `1`
- `type`: `static` or `worker`
- `root`
- `build.install`
- `build.command`
- `build.output`
- `worker.entry`
- `routes.fallback`
- `deploy.adapter`: currently only `cloudflare-workers`
- `deploy.wrangler`: relative Wrangler config path used to read the Worker entry
- `[[agents]]`: repeated `name`, `expose = "public_thread"`, and `env` tables

The top-level `name` is parsed today but is not used in the resulting deployment
plan or resource naming; Mosoo derives the target from the App id/subdomain.

Mosoo owns and generates:

- Cloudflare account ID.
- Pages project name or Worker script name.
- Routes and Mosoo subdomain.
- `compatibility_date`.
- Asset binding shape.
- Observability/logging defaults.
- Any platform secrets or environment variables.
- D1, R2, KV, Queues, Durable Objects, user-supplied custom domains, and paid-resource
  bindings.

If users need a Cloudflare field not represented in `.mosoo.toml`, add it to the
Mosoo config schema first. Do not pass through arbitrary Wrangler config.

## Deployment Execution

The control plane does not run arbitrary repository code inline.

1. `deployApp` validates the GitHub source, creates or reuses the App Deployment, creates a queued
   Deployment Run, and enqueues the dispatch command.
2. The asynchronous executor resolves the repository's default branch and exact commit, then
   detects or validates the `DeploymentPlan`.
3. The worker clones the exact commit in an isolated build sandbox.
4. Install and build run without Cloudflare credentials.
5. The build emits a static artifact directory, Worker bundle, or both.
6. Mosoo generates a sanitized Wrangler configuration from the detected plan plus
   optional `.mosoo.toml` overrides.
7. The authenticated deploy step runs only after build. Pages uses controlled
   Wrangler in a separate deploy sandbox; Workers uses
   `CloudflareDeploymentClient` backed by the official Cloudflare TypeScript SDK.
8. The run stores Cloudflare project/script IDs, external deployment/version IDs,
   status, failure summary, and the final URL.

Do not put `CLOUDFLARE_API_TOKEN` in the environment for `npm install`,
`pnpm install`, `bun install`, `npm run build`, or any repository-owned script.
Public GitHub code is untrusted. Mosoo platform credentials are available only
to the deploy step, after repository-owned code has finished running.

## Cloudflare Target Rules

### Static Pages

Use Cloudflare Pages for static output when the repository builds to a directory
and has no required Worker runtime.

Current implementation path:

- Build in sandbox with no Cloudflare credential.
- Pack the output, destroy the untrusted build sandbox, and unpack it in a
  controlled deploy sandbox.
- Run authenticated `wrangler pages deploy` only in that controlled sandbox.
- Use the Cloudflare SDK to manage/read the Pages project and domain around that
  upload.

Mosoo requests the planned Mosoo-managed domain, but the current success path stores
the Pages deployment URL when that domain is still initializing. Therefore
`liveUrl` can be a `pages.dev` address while `plannedUrl` remains the reserved
Mosoo-owned host.

### Dynamic Workers

Use Cloudflare Workers when the repository has a self-contained JavaScript
Worker module and needs request-time logic.

Current implementation path:

- Package Worker code without Cloudflare credentials.
- Generate Wrangler config from the detected plan plus optional `.mosoo.toml`.
- Upload a Worker module/version through the Cloudflare TypeScript SDK.
- Create a deployment that sends 100% traffic to the new version.

Use the SDK for the final authenticated step instead of running authenticated
Wrangler inside untrusted source.

### Pages Functions

Pages Functions and Workers-with-assets are not emitted by the current detector.
They require a later explicit contract and executor path.

Switching one App between Pages and Worker targets has no explicit cleanup step
for the previous target kind in the current executor. Delete attempts cleanup of
both kinds, but whether a target switch leaves an external orphan needs an
integration test; no cleanup guarantee is claimed here.

## Current Data Model

`app_deployment`:

- `id`
- `app_id`
- `owner_account_id`
- `source_kind`: `github_public`
- `repo_url`
- `repo_owner`
- `repo_name`
- `default_branch`
- `mosoo_subdomain`
- `latest_run_id`
- `last_successful_url`
- `deleting_at`
- `deleted_at`
- `created_at`
- `updated_at`

`app_deployment_run`:

- `id`
- `deployment_id`
- `app_id`
- `status`: `queued`, `preparing`, `building`, `submitting`, `submitted`,
  `activating`, `success`, `failed`
- `source_commit_sha`
- `source_branch`
- `plan_json`
- `mosoo_config_json`
- `generated_wrangler_config_json`
- `target_kind`
- `target_project_name`
- `target_script_name`
- `external_project_id`
- `external_deployment_id`
- `external_version_id`
- `url`
- `error_code`
- `error_message`
- `created_at`
- `updated_at`

Index by `(app_id, id)` and order run lists by `id`.

## API Shape

GraphQL follows the existing Console API style: App-scoped fields,
camelCase names, and mutation inputs with explicit `appId`.

Current fields:

- `appOverview(appId: ULID!): AppOverview!` exposes `deployment: AppDeployment` (the App's configured Deployment, or null).
- `deployApp(input: DeployAppInput!): AppDeploymentRun!`
- `appDeploymentRunList(appId: ULID!, limit: Int): [AppDeploymentRun!]!`
- `appDeploymentStatus(appId: ULID!): AppDeploymentRun`
- `deleteAppDeployment(input: DeleteAppDeploymentInput!): OperationResult!`

Current input:

```graphql
input DeployAppInput {
  appId: ULID!
  repoUrl: String!
  configPath: String
}

input DeleteAppDeploymentInput {
  appId: ULID!
}
```

`appId` is required. Do not infer the App from the current account or repository.
Status always targets the latest DeploymentRun for the App. `configPath` is
optional and must be absent or `.mosoo.toml` in the current contract.
`AppOverview.deployment` returns null when the App has no configured Deployment.
`appDeploymentStatus` returns null when the App has no DeploymentRun.
Deployment always uses the GitHub repository's current default branch; explicit
branch selection is not part of the current contract.

The shipped `mosoo console apps deploy-app` CLI is a wrapper around this
Mosoo-owned deployment flow. It accepts the App id, public repository URL,
and optional `.mosoo.toml` config path. Pass `--wait` to poll the long-running
operation in the command, or omit it and later call `mosoo console apps
app-deployment-status --app-id <app-id> -o json`. The command does not accept
Cloudflare credential flags. The CLI implementation lives in
`langgenius/mosoo-connector`, while these GraphQL fields and this PRD remain the
deployment contract.

## Async Status Model

`deployApp` creates or reuses the App Deployment, creates a new DeploymentRun,
submits the work, and returns immediately after Mosoo accepts the run. It must
not wait for Cloudflare to finish deployment.

The initial response can include:

- `runId`, for API callers only.
- `status`.
- `plannedUrl`, the Mosoo-owned URL reserved for this App.
- `liveUrl`, null until the latest run succeeds.

The console shows status and URL without requiring users to copy or pass a run
ID.

Statuses:

- `queued`
- `preparing`
- `building`
- `submitting`
- `submitted`
- `activating`
- `success`
- `failed`

`submitted` means Mosoo has handed work to Cloudflare or the deployment queue.
`success` means Mosoo completed its activation checks and recorded a live URL.
It is not a traffic-atomic guarantee: the current Worker path creates a 100%
deployment, and Pages uploads an artifact, before the final activation/status
write. A later failure has no automatic rollback and the external target may
already be reachable.

Delete first writes `deleting_at`, which hides the live URL, revokes bound
capabilities, blocks redeploy, fails active runs, and cancels queued/expired
dispatch claims. A live dispatch claim must finish before cleanup can continue.
Cloudflare Pages/Worker deletion is idempotent and all target kinds must report
success before Mosoo writes `deleted_at`; otherwise the mutation returns a
retryable error and keeps the deletion ledger. A later Delete retries from that
state. Historical DeploymentRun rows remain. `{ ok: true }` therefore means the
known external resources were deleted and the tombstone was committed, while a
crash/failure remains visible as an unfinished deletion rather than false
success.

## Failure Model

Current failures do not implement a stable versioned error-code catalog.
Binding failures persist explicit `deployment_agent_not_found` or
`deployment_agent_not_published`; lifecycle races use codes such as
`deployment_context_lost`, and queue retry exhaustion has its own code. Detector
and non-retryable executor failures are otherwise persisted from JavaScript
error names (for example `AppDeploymentDetectionError`) rather than their more
specific `.code`. GitHub validation can fail before a DeploymentRun is created.
The API/console surface stored summaries; deployment logs are not exposed.

## Security Rules

- Only `https://github.com/<owner>/<repo>` public repositories in the current contract.
- Clone by resolved commit SHA, not floating branch name.
- Build in a sandbox with no Mosoo internal secrets and no Cloudflare token.
- Redact exact known platform secret-binding values plus Authorization/Cookie
  headers, sensitive credential key/value lines, bound capability URLs, and
  known provider token prefixes before log/error persistence. Pattern-based
  detection remains defense in depth for secrets not present in the bindings.
- The Sandbox boundary exists, but explicit whole-build CPU, memory, file-count,
  artifact-size, and wall-clock limits are not currently enforced by this
  executor. Pages packaging and Worker entry reads can buffer artifacts in API
  memory; this is an implementation gap, not a shipped quota contract.
- Do not run user-provided deploy commands with Cloudflare credentials.
- Mosoo platform Cloudflare token permissions must be minimal for Pages/Workers
  deploys.
- Never pass through arbitrary user Wrangler config.

## Implemented Baseline

The shipped path includes:

- One App has zero or one configured Deployment.
- Public GitHub repository source only.
- Automatic app type and command detection by default.
- Optional root `.mosoo.toml` override.
- GitHub default branch only.
- Static Pages deploy for known static output.
- Worker deploy for detected or configured Worker projects.
- Cloudflare TypeScript SDK adapter for Pages management/delete and Workers
  deploy/delete, plus controlled Wrangler for Pages artifact upload.
- GraphQL deploy, run-list, latest-status, and delete fields.
- Store and show last successful URL on App Overview.
- Mosoo-owned public URL.

Skip for now:

- Deployment logs API and CLI.
- Private GitHub repositories.
- Explicit branch selection.
- GitHub webhooks and automatic redeploy.
- User-supplied custom domains (Mosoo-managed Pages/Worker domains are current).
- Preview branches.
- Rollback UI.
- Cloudflare resource provisioning for D1/R2/KV/Queues/DO.
- Multi-target deployments per App.
- Pages Functions as a first-class branch.
- User-owned Cloudflare account deployment.

## Agent Binding Baseline

The base PRD deploys a public repo to a Mosoo-owned URL. This addendum adds the
v0 differentiator: a deployed app can call the App's own Mosoo Agents through
values injected at deploy time, with no secret in app code. Aligned with the PM
on 2026-06-30 via [`pm-reverse-interview.md`](../pm-reverse-interview.md); the four decisions below are
product-level (user-visible), the rest is engineering freedom.

### Product Decisions (PM-aligned)

1. **Zero secrets in app code.** When a deployed app calls a bound Agent, it
   reads exactly one "just works" value per agent and nothing else. Implemented
   as a self-authorizing capability URL scoped to (App, Agent, Deployment,
   successful Deployment Run, expose mode); no token, PAT, or manual rotation
   control is exposed to the app.
2. **One call returns a bounded reply.** The deployed app sends the user's
   message to the injected URL in a single request and gets
   `{ reply, runId, truncated }`. Mosoo runs create-thread → run → wait →
   final-output behind the URL, bounded by both a timeout and the 1 MiB / 4,096
   final-output reconstruction budget. Streaming, continuation, and long-running
   runs are Next.
3. **Worker deploy aborts on an unpublished binding.** If a Worker
   `.mosoo.toml` binds an Agent that is not published/live, deploy fails before
   build/deploy. Static Pages plans reject Agent bindings entirely. No
   auto-publish occurs.
4. **Deployment lives in App Overview.** An App that has never deployed shows the install guide,
   repository input, and initial activity state in Overview. Once configured, the same surface
   shows status, live URL, source, run history, retry/redeploy, and delete; delete confirmation
   shows the bound-Agent count, not a binding detail list. The old
   `/deployments` route redirects to `/`.

### `.mosoo.toml` Binding Contract

Adds an optional repeated `[[agents]]` table to the override contract:

```toml
[[agents]]
name   = "roadmap"            # Agent name within this App (the binding key)
expose = "public_thread"      # only supported mode in v0
env    = "ROADMAP_THREAD_URL" # env var the deployed app reads
```

- `name` resolves an Agent within the deploying App. The current parser accepts
  only `name`, `expose`, and `env`; an `id` field is rejected. Agent names are
  not unique, and the current name map silently chooses one duplicate. The
  stored plan retains names rather than immutable resolved Agent ids, so rename
  and duplicate-name drift are known limitations.
- `expose` must be `public_thread` in v0.
- `env` is the exact environment variable name the deployed app reads. Mosoo does
  not auto-derive it; the app code and the manifest must agree.
- Mosoo still owns all other env/secrets (base PRD). `[[agents]]` only declares
  agent bindings.

### Injected Binding Behavior

For each `[[agents]]` entry, the deploy step injects one environment variable
(`env`) whose value is a self-authorizing URL. The deployed app does:

```
POST <injected_url>   body: { "message": "…" }
  → { "reply": "…", "runId": "…", "truncated": false }
```

The URL is a capability scoped to (App, Agent, Deployment, successful
Deployment Run, `public_thread`). The current
executor resolves bindings and mints it before the untrusted build, but keeps it
in API memory and passes it only to the authenticated deploy step, not to
repo-owned build scripts. Behind it, Mosoo creates a Thread, sends
the message, waits for the Run to complete within a bounded timeout, and returns
the bounded final-output prefix plus an explicit truncation flag.

There is no separate token row or per-binding rotation epoch. The ten-year
expiry is only an upper bound: every call rechecks that the Deployment is active
and that the token names its newest successful Deployment Run. Deleting the
Deployment or completing a newer deploy revokes copied older URLs;
unpublishing/moving the Agent also fails closed. Global signing-secret rotation
remains the emergency path for historical leaks. Treat every URL as a secret.

Bound-call dispatch now derives and persists only the public API origin; the
capability path, query, and bearer-like token are stripped before enqueue. A
unit contract guards that boundary. Rows written before this fix may still
contain the full URL, so historical cleanup and signing-secret rotation remain
a separately authorized production operation.

The blocking call waits up to 25 seconds. Timeout returns no run handle, does not
cancel the background Run, and a caller retry is not idempotent; it can duplicate
execution and cost.

### Deploy-Time Resolution

Before build: parse `[[agents]]`, resolve each `name` to a published Agent in the
App, and mint one capability URL per binding. Missing/unpublished bindings abort
before build. The values are withheld from repo-owned commands and injected only
when deploying a Worker. Static Pages plans reject non-empty Agent bindings and
have no Agent environment injection path.

### Console Surface

App Overview shows the live URL and activity ledger plus retry/redeploy/delete.
The overview API returns bound-Agent name/exposure/env metadata, but the current
Web surface uses only the binding count in its delete confirmation; it does not
render the promised Agent/env list. Before the first deploy, Overview shows the
install guide and repository input. Injected URLs are never returned to Web.

### Failure Model Additions

- `deployment_agent_not_published` — a `[[agents]]` binding references an Agent
  that is not published/live.
- `deployment_agent_call_timeout` — the one-call "ask" exceeded its bounded wait
  (surfaced to the deployed app, not the deploy run).

### Implemented Agent Binding Baseline

The shipped path includes:

- Parse `[[agents]]` (`name`, `expose=public_thread`, `env`).
- Resolve bindings to published Agents; fail fast on unpublished.
- Mint one self-authorizing capability URL per Worker binding; inject as the
  declared `env`. Static Pages plans reject Agent bindings.
- One blocking "ask" endpoint behind the capability URL (reuse the public-thread
  `createThreadAndWait` path) with a bounded timeout.
- Overview API exposes bound Agent/env metadata; Web currently shows only the
  count in delete confirmation plus the deploy-guide empty state.

Skip for now (Next): streaming / long-running ask, expose modes other than
`public_thread`, binding Agents from other Apps, user-supplied tokens, and
binding-name-collision UI, independent/manual capability rotation without a new
successful Deployment Run, and a shorter capability lifetime.

### Engineering Decisions (owned, not PM — record in `architecture.md`)

GraphQL document + codegen wiring; capability-URL crypto (signing vs stored
token row); where the injection hooks in the executor; poll-vs-stream for the
ask endpoint's wait; TanStack query keys for the console.

## External References

Checked on 2026-06-26:

- [Cloudflare SDK docs](https://developers.cloudflare.com/fundamentals/api/reference/sdks/)
- [Cloudflare TypeScript SDK](https://github.com/cloudflare/cloudflare-typescript)
- [Cloudflare Pages framework guides](https://developers.cloudflare.com/pages/framework-guides/)
- [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Cloudflare Pages Create project API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/create/)
- [Cloudflare Pages Create deployment API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/create/)
- [Cloudflare Workers framework guides](https://developers.cloudflare.com/workers/framework-guides/)
- [Wrangler Workers deploy command](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
- [Wrangler Pages deploy command](https://developers.cloudflare.com/workers/wrangler/commands/pages/)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare Workers upload module API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/)
- [Cloudflare Workers upload version API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/create/)
- [Cloudflare Workers create deployment API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/create/)
- [GitHub Get a repository API](https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28#get-a-repository)
- [GitHub Get a branch API](https://docs.github.com/en/rest/branches/branches?apiVersion=2022-11-28#get-a-branch)
