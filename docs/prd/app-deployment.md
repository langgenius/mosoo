# App Deployment

Status: proposal.

This document reopens the Web deployment/public URL decision that `App Boundary`
kept out of the V1 path. The reopened shape is explicit: deployment is an
App-owned resource named `Deployment`. It is not App runtime, not `Publish App`,
and not an Agent `DeploymentVersion`.

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
7. Mosoo stores the successful Mosoo-owned URL and shows it whenever the user
   views the App.

The first cut should support one active Deployment per App. Multiple deployment
targets, custom domains, branch previews, and automatic redeploys are later.

## Existing Boundary Conflict

Current App docs explicitly say App has no runtime, no App-level API endpoint,
no Web shell, and no public preview URL. This feature is therefore a product
decision change. Keep the change narrow:

- `App` remains the business/resource boundary.
- `Deployment` is the App-owned external Web artifact.
- Agent design, Agent runtime, Agent Sessions, and `AgentDeploymentVersion`
  remain unrelated.
- `DeploymentRun` is one deployment attempt for a Deployment.

Do not reuse `agent_deployment_version` for Cloudflare deployments.

## Required Product Decision

Production deploys target Mosoo's Cloudflare account. This is a paid platform
capability because Mosoo owns the Cloudflare resources, billing, quotas, abuse
controls, and final customer-facing subdomain.

The default public URL shape should be Mosoo-owned, for example:

```text
https://<app-slug>.apps.mosoo.ai
```

The exact subdomain policy can change, but the invariant does not: users do not
bring their own Cloudflare account in the first cut.

## Technology Stack

Use the existing Mosoo stack:

- D1 for Deployment and DeploymentRun metadata.
- R2 for build logs and optional packed artifacts.
- Queues for asynchronous deployment work.
- Existing App ownership checks for access control.
- Mosoo platform Cloudflare credentials stored outside user-controlled App
  configuration.
- Existing Sandbox/Container execution boundary for cloning and building public
  GitHub repositories.
- Official Cloudflare TypeScript SDK package `cloudflare` for Cloudflare
  management APIs.
- Wrangler for Mosoo's own local development, type generation, and generated
  config validation. Do not use authenticated Wrangler inside untrusted user
  repositories.

External surfaces:

- GitHub REST API for repository identity, default branch, language bytes, root
  contents, and tree scans.
- Cloudflare TypeScript SDK for Pages project/deployment and Workers
  script/version/deployment APIs.
- Optional root `.mosoo.toml` as the user override contract.
- Generated Wrangler config as an internal deployment artifact.

## Repository Detection

Detection reads public GitHub facts first, then clones the pinned commit only if
the repository passes the cheap checks. The default path is automatic detection;
`.mosoo.toml` only overrides detection when present at the repository root.

GitHub facts:

- `owner`, `repo`, visibility, default branch, clone URL.
- default branch commit SHA.
- language byte map.
- root files from Contents API.
- recursive tree listing when small enough.

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
  rootDir: string;
  packageManager: "pnpm" | "npm" | "yarn" | "bun" | "none";
  installCommand: string | null;
  buildCommand: string | null;
  outputDir: string | null;
  targetKind: "cloudflare_pages" | "cloudflare_worker";
  targetMode: "static_assets" | "worker_module" | "worker_with_assets";
  mosooConfigPath: ".mosoo.toml" | null;
  generatedWranglerConfig: string;
  warnings: string[];
}
```

Do not infer D1, R2, KV, Queues, Durable Objects, custom domains, or secrets from
package dependencies. Those require explicit user configuration.

## Cloudflare Support And Detector MVP

Cloudflare can run more shapes than Mosoo should detect in the first cut:

- Pages handles static sites and static framework output.
- Workers handles request-time logic and can also serve static assets.
- Pages Functions can run dynamic code, but should not be a first-class branch
  in the MVP.

The detector is a whitelist, not a full Cloudflare framework adapter. If a
repository needs migration, adapter installation, framework-specific SSR
configuration, bindings, or secrets, return `deployment_config_required`.

First-cut detector table:

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
in the first cut. It describes application intent, not raw Cloudflare
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

Allowed first-cut fields:

- `name`
- `type`: `static` or `worker`
- `root`
- `build.install`
- `build.command`
- `build.output`
- `worker.entry`
- `routes.fallback`

Mosoo owns and generates:

- Cloudflare account ID.
- Pages project name or Worker script name.
- Routes and Mosoo subdomain.
- `compatibility_date`.
- Asset binding shape.
- Observability/logging defaults.
- Any platform secrets or environment variables.
- D1, R2, KV, Queues, Durable Objects, custom domains, and paid-resource
  bindings.

If users need a Cloudflare field not represented in `.mosoo.toml`, add it to the
Mosoo config schema first. Do not pass through arbitrary Wrangler config.

## Deployment Execution

The control plane does not run arbitrary repository code inline.

1. `setDeploymentSource` stores the GitHub source URL, owner, repo, default
   branch, and normalized source kind.
2. `analyzeDeployment` creates or refreshes a `DeploymentPlan`.
3. `startDeployment` creates a `DeploymentRun` and enqueues it.
4. The worker clones the exact commit in an isolated build sandbox.
5. Install and build run without Cloudflare credentials.
6. The build emits a static artifact directory, Worker bundle, or both.
7. Mosoo generates a sanitized Wrangler configuration from the detected plan plus
   optional `.mosoo.toml` overrides.
8. The authenticated deploy step runs after build through
   `CloudflareDeploymentClient`, backed by the official Cloudflare TypeScript
   SDK and Mosoo platform credentials.
9. The run stores Cloudflare project/script IDs, external deployment/version IDs,
   status, internal logs, and the final URL.

Do not put `CLOUDFLARE_API_TOKEN` in the environment for `npm install`,
`pnpm install`, `bun install`, `npm run build`, or any repository-owned script.
Public GitHub code is untrusted. Mosoo platform credentials are available only
to the deploy step, after repository-owned code has finished running.

## Cloudflare Target Rules

### Static Pages

Use Cloudflare Pages for static output when the repository builds to a directory
and has no required Worker runtime.

First implementation path:

- Build in sandbox with no Cloudflare credential.
- Upload the output directory through the Cloudflare TypeScript SDK.
- Use Mosoo-generated config and platform credentials only from the artifact
  deploy step.

Store the primary URL from the resulting Pages deployment aliases or project
subdomain, then map or expose the Mosoo-owned subdomain.

### Dynamic Workers

Use Cloudflare Workers when the repository has Worker code, needs request-time
logic, or combines static assets with API routes.

First implementation path:

- Package Worker code without Cloudflare credentials.
- Generate Wrangler config from the detected plan plus optional `.mosoo.toml`.
- Upload a Worker module/version through the Cloudflare TypeScript SDK.
- Create a deployment that sends 100% traffic to the new version.
- For static assets plus Worker code, use Workers Static Assets and keep the
  assets directory explicit in generated Wrangler config.

Use the SDK for the final authenticated step instead of running authenticated
Wrangler inside untrusted source.

### Pages Functions

Treat Pages Functions as a later cut unless a repository already has a clean,
supported Pages project shape. Workers with Static Assets covers the same
dynamic-site need with fewer product branches.

## Data Model Sketch

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

GraphQL should follow the existing Console API style: App-scoped fields,
camelCase names, and mutation inputs with explicit `appId`.

First-cut fields:

- `appDeployment(appId: ULID!): AppDeployment`
- `deployApp(input: DeployAppInput!): AppDeploymentRun!`
- `appDeploymentStatus(appId: ULID!): AppDeploymentRun`
- `deleteAppDeployment(input: DeleteAppDeploymentInput!): OperationResult!`

First-cut input:

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
First-cut status always targets the latest DeploymentRun for the App. `configPath`
is optional and must be absent or `.mosoo.toml` in the first cut.
`appDeployment` returns null when the App has no configured Deployment.
`appDeploymentStatus` returns null when the App has no DeploymentRun.
Deployment always uses the GitHub repository's current default branch; explicit
branch selection is not part of the first cut.

CLI is out of scope for this API PRD. A future CLI wrapper should call these
GraphQL fields and must not accept Cloudflare credential flags.

## Async Status Model

`deployApp` creates or reuses the App Deployment, creates a new DeploymentRun,
submits the work, and returns immediately after Mosoo accepts the run. It must
not wait for Cloudflare to finish deployment.

The initial response can include:

- `runId`, for API callers only.
- `status`.
- `plannedUrl`, the Mosoo-owned URL reserved for this App.
- `liveUrl`, null until the latest run succeeds.

First-cut product clients should show status and URL, but should not require
users to copy or pass a run ID.

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
Only `success` means the URL is live.

Delete removes the App's current deployment. It should remove or disable the
Mosoo-owned route/subdomain and delete the corresponding Mosoo-managed
Cloudflare Pages project or Worker script when possible. If a run is in progress,
delete should stop local work first and then tear down the external deployment
resource. Historical DeploymentRun rows remain for status/audit, but the App no
longer has a live deployment URL after delete succeeds.

## Failure Model

Use explicit error codes:

- `github_url_invalid`
- `github_repo_not_found`
- `github_repo_not_public`
- `deployment_shape_unsupported`
- `deployment_config_required`
- `deployment_build_failed`
- `deployment_artifact_too_large`
- `mosoo_cloudflare_unavailable`
- `cloudflare_deploy_failed`
- `deployment_url_unavailable`
- `deployment_delete_failed`

Store user-readable failure summaries on `DeploymentRun`. First cut does not
expose deployment logs through API or CLI.

## Security Rules

- Only `https://github.com/<owner>/<repo>` public repositories in the first cut.
- Clone by resolved commit SHA, not floating branch name.
- Build in a sandbox with no Mosoo internal secrets and no Cloudflare token.
- Redact token-like strings in logs before persistence.
- Enforce CPU, memory, file count, artifact size, and wall-clock limits.
- Do not run user-provided deploy commands with Cloudflare credentials.
- Mosoo platform Cloudflare token permissions must be minimal for Pages/Workers
  deploys.
- Never pass through arbitrary user Wrangler config.

## MVP Cut

Build this first:

- One App has zero or one configured Deployment.
- Public GitHub repository source only.
- Automatic app type and command detection by default.
- Optional root `.mosoo.toml` override.
- GitHub default branch only.
- Static Pages deploy for known static output.
- Worker deploy for detected or configured Worker projects.
- Cloudflare TypeScript SDK adapter for Pages and Workers deploy/delete.
- GraphQL deploy, latest-status, and delete fields.
- Store and show last successful URL on App Overview.
- Mosoo-owned public URL.

Skip for now:

- CLI implementation.
- Deployment logs API and CLI.
- Private GitHub repositories.
- Explicit branch selection.
- GitHub webhooks and automatic redeploy.
- Custom domains.
- Preview branches.
- Rollback UI.
- Cloudflare resource provisioning for D1/R2/KV/Queues/DO.
- Multi-target deployments per App.
- Pages Functions as a first-class branch.
- User-owned Cloudflare account deployment.

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
- [GitHub repository languages API](https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28#list-repository-languages)
- [GitHub repository contents API](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28#get-repository-content)
- [GitHub Git tree API](https://docs.github.com/en/rest/git/trees?apiVersion=2022-11-28#get-a-tree)
