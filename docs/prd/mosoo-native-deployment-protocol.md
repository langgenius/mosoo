# Mosoo Native Deployment Protocol PRD

Status: draft implementation contract · **single source of truth** for the Mosoo Native deployable contract · Last updated: 2026-07-07.

This PRD consolidates what previously lived in five places: the product protocol draft (`docs/product/mosoo-native-deployment-protocol.md`, folded in and removed), the resolved decisions #16–#25 of the [Agent App market decision map](../product/agent-app-market-decision-map.md), ADR [0001](../adr/0001-use-mosoo-native-deployment-protocol-as-the-agent-app-deployable-contract.md)/[0002](../adr/0002-split-agent-definition-from-deployment-exposure-config.md)/[0003](../adr/0003-use-mosoo-native-protocol-instead-of-generic-repo-detection.md) (the records remain authoritative as decisions; this PRD carries their consequences), and the locked decisions of the [Native Deployment Happy Path](../product/native-deployment-happy-path.md) demo contract and [Native Deployment Workplan](../product/native-deployment-workplan.md). Where earlier drafts conflict, this PRD wins; each superseded choice is marked **Superseded** inline so the history stays legible.

It describes the target product contract. It does not claim that every capability below already exists in the current implementation (see Current Implementation Mapping).

Naming lock: the deployable artifact is formally a **Mosoo Native Deployable** (informally "the artifact" or "the repo"). Earlier mixed spellings — "Mosoo app repo", "package" — resolve to this term.

## Problem Statement

Mosoo's target users will ask Codex, a local coding agent, or a future Mosoo App Builder to produce a deployable repository. Mosoo currently lacks a stable repo-level contract that tells the coding agent which files define Agents, which files define deployment exposure, how validation works, how deployment happens, and what output the user should receive after deployment.

The current pipeline confirms the gap mechanically: a repo can *reference* agents but cannot *define* them. `[[agents]]` in `.mosoo.toml` resolves by name against agents that already exist and are published on the target instance, so agent identity is instance state the repo cannot provision, and a repo that deploys green on instance A fails on instance B (`deployment_agent_not_found`). Two ship verbs exist and do not compose: `publishAgent` freezes a version and makes the endpoint answer but emits no repo; `deployApp` builds the web artifact and binds by name but defines no agent. The artifact is not self-sufficient by construction.

If Mosoo becomes a generic repo detector, it falls back into Railway / Nixpacks-style process hosting: scan the language ecosystem, infer build/start/port behavior, and try to run arbitrary code. That layer is already commoditized, and it does not expose the Agent/session/delegation lifecycle that Mosoo needs to productize.

If Mosoo asks users to pick hard application types such as API Agent, Channel Agent, Web Agent, or Digital Employee, it creates the wrong mental model. Users and coding agents need one deployable contract: how the Agent is equipped, how one delegation is accepted, where requests enter, and where results are delivered.

## Solution

Define Mosoo Native Deployment Protocol v1. A repo must be intentionally authored as a Mosoo Native Deployable before Mosoo deploys it. Mosoo does not guess arbitrary repos and does not ask the user to choose a hard business type. It reads standard files, validates them, and turns the repo into Agents inside one App, App-local resources, name-addressed Agent API endpoints, and optional Web deployments.

The portability thesis: **one repo, any Mosoo**. The only state a target instance must pre-hold is provider credentials plus the org/app shell; everything else travels in the artifact, and secrets never travel. A protocol-valid repo deploys green on an instance it has never touched, unmodified — deploy provisions (upserts) the agents the repo defines instead of binding to pre-existing ones.

The minimum v1 repo marker is a root `.mosoo.toml`:

```toml
spec = "mosoo.spec.v1"
```

Agent definitions live in `.agent/`. Deployment and exposure configuration lives in `.mosoo.toml`. Secrets never live in deployable files. They can only appear as Mosoo credential setup, credential references, or post-deploy setup requirements.

The first MVP user path: a coding agent writes Mosoo Native files; `mosoo validate` reports red with repo-term fix hints until the files are deployable; the user deploys — by pasting the repo URL into the console or by running `mosoo deploy` — and receives, per exposed Agent, a name-addressed API endpoint under the App namespace plus the App's OpenAPI URL, with auth riding the existing account PAT flow. If the repo declares Web exposure, Mosoo also outputs a Web deployment URL. Deploying the same repo on a second instance produces the same result with zero edits.

## Repository Structure

A Mosoo Native repo uses one root deployment marker plus one Agent definition surface:

```text
my-repo/
├── .agent/
│   ├── manifest.json
│   ├── agents/
│   │   └── <agent-name>/
│   │       └── manifest.json
│   ├── skills/
│   ├── .mcp.json
│   └── environment/
│       └── definition.json
├── .mosoo.toml
└── src/
```

Required in MVP:

- `.mosoo.toml` is always required. It declares that the repo is a Mosoo Native Deployable.
- `.agent/manifest.json` is required for the single-Agent shorthand and represents the primary Agent.
- `src/` is optional. It is only needed when the repo includes hosted Web / Worker code.

Optional in MVP:

- `.agent/agents/<agent-name>/manifest.json` is used when the repo declares multiple named Agents. Shared Skills, MCP, and Environment stay at `.agent/` root and are referenced from each Agent manifest.
- `.agent/skills/` carries reusable Skills referenced by Agent manifests (agentskills.io-style directories).
- `.agent/.mcp.json` carries MCP server intent and must not contain plaintext credentials.
- `.agent/environment/definition.json` carries Environment requirements (packages, setup, network policy) and must not contain secret values.

The minimum Agent-only repo is:

```text
my-repo/
├── .agent/
│   └── manifest.json
└── .mosoo.toml
```

with the one-line `.mosoo.toml` above. A Web repo that calls a named Agent declares Web exposure in `.mosoo.toml`:

```toml
spec = "mosoo.spec.v1"

[expose.web]
agent = "support"
build = "npm run build"
```

Boundary rules:

| Surface | Owns | Does not own |
| --- | --- | --- |
| `.agent/` | Reusable Agent definition set: one primary Agent or multiple named Agents — identity, kind, runtime intent, model, behavior instructions, Skills, MCP, Environment requirements | Repo-local exposure, host build/deploy, plaintext secrets |
| `.mosoo.toml` | Native repo marker and repo-local deployment exposure: Web surface, target-Agent binding, per-agent expose subset, build/deploy overrides, host-layer config, setup requirements | Agent identity or capability, plaintext secrets |
| `src/` | Hosted Web app, Worker, API glue, or other ordinary code | Agent definition |

Additional rules:

- Agent behavior instructions live in the relevant Agent's `manifest.json`. v1 does not introduce a separate instructions file.
- `.agent/` must stay portable: imported into another App, instance, or owner, every Agent's runtime/model/MCP/Environment/credentials re-resolve in the target App context.
- Existing `.agent` package contracts are the current single-Agent package anchor. Multi-Agent repo layout is target v1 source structure and still needs implementation; the exact multi-agent directory shape is Phase 0 contract work in `pkgs/contracts`.
- Secrets never belong in `.agent/`, `.mosoo.toml`, or `src/` as protocol data.

## Deployment Semantics

**Detection boundary** *(recommended default; confirm at Phase 0 entry)*: if the Native marker (`.mosoo.toml` with `spec = "mosoo.spec.v1"`) is present, the repo takes the protocol path; a plain static/worker repo without agents keeps the existing generic detector. A protocol repo never falls back to generic detection — missing or invalid protocol files are an authoring error with repo-term diagnostics, and detection always names what it found (protocol version, target, agent count) or states what is missing. The null "detecting target" label disappears.

**Upsert, not bind.** One deploy upserts *all* Agents the repo defines — new, updated, unchanged — inside the target App, reusing the `.agent` package import philosophy (resolve by name, re-mint instance ids, blank secrets) as the provisioning engine. Deploy subsumes publish on the protocol path: upserted agents are auto-published and their endpoints activate without a separate publish step. This retires `deployment_agent_not_found` as a cross-instance failure class.

**The Publish verb splits.** Publish (agent-level) remains a state flip — draft → callable, minting a DeploymentVersion — and becomes an internal/secondary verb. The artifact-level deliverable is the protocol repo; deploy consumes it. On the console path (Path B), the Publish button remains but its success surface presents the App-level deliverable (protocol-shaped repo export / conformance), not a per-agent distribution quartet.

**Version provenance = commit.** For repo-backed apps, the commit SHA versions the artifact as a whole; per-agent DeploymentVersions are snapshots derived from the commit, and Production Activity shows commit-linked versions. Console-authored apps keep publish-minted versions. Running threads keep their execution snapshot in both cases.

**Three entrances, one object.** Console deploy button (paste a repo URL), the generated CLI (`mosoo deploy`), and later a git webhook all create the same DeploymentRun object in the same activity table. There is no CLI-flavored deploy.

**App binding and resource reuse** (CLI entrance): the current repo is bound to one Mosoo App through local deploy state (`orgId` / `appId`, like Vercel's `.vercel/project.json`); subsequent deploys only update resources inside that App. First deploy without a binding can create a new App or bind to an explicit one via `mosoo deploy --app <app-id>` / `mosoo link`. Local deploy state is not part of the protocol and must not store secrets. Mosoo never guesses resource reuse by name across Apps or workspaces: missing binding, missing permission, or non-unique targets stop the deploy. The console entrance operates within the current App and needs no local state.

**Fail-fast, no confirmation theater.** `mosoo deploy` means validate plus deploy and writes directly by default. If blocking setup is missing, the target is ambiguous, or the operation would be dangerous, it fails fast with a repair action. The MVP introduces no default confirmation and no `--yes` state machine; risk control is the validator, explicit targets, and fail-fast.

## API Namespace & Access

**The App's API is a namespace, not an endpoint.** Exposed agents are addressed by name inside an app-scoped base path:

```text
…/api/v1/apps/{app-slug}/agents/{name}/threads
```

- The API surface is exactly the per-agent expose subset: agents may be defined but internal, and internal agents get no public endpoint (they still deploy and serve in-App roles). Exposure rule *(confirm at Phase 0 entry)*: a single-agent repo exposes its primary Agent by default — deploying an Agent yields an endpoint with zero exposure declarations, and `[expose.api]` stays nonexistent; a multi-agent repo declares per-agent exposure explicitly in `.mosoo.toml`, mirroring the Web-binding rule (single → implicit primary, multi → explicit target). The exact TOML field shape is Phase 0 contract work.
- No ULID appears in any path the console or CLI displays. Agent ULIDs stay on internal/management surfaces.
- No default-agent shorthand route (`…/apps/{slug}/threads`): it saves ten characters and breaks the day a second agent is exposed. Explicit names always.
- What the App owns is the namespace, the per-App OpenAPI document, and quota — not an App-level runtime endpoint. Thread creation still targets one Agent, so the SPEC rule "no App-level runtime endpoint" holds. Reference shape: Supabase Edge Functions (`PROJECT.supabase.co/functions/v1/hello-world` + project key).
- The app slug appears in every path, so slug stability is the API compatibility promise. Slug minting and rename policy is an open decision (see Open Decisions).

**Auth rides account PATs in v1.** After deploy, the output points at the existing PAT flow (`mosoo tokens create`; the generated CLI's `auth login` already works this way). App-scoped keys are the eventual direction, explicitly deferred; per-agent key restrictions under an App key are API-gateway territory and wait for real demand.

> **Superseded** (decision map #24, earlier PRD draft): "`mosoo deploy` auto-creates a one-time visible Agent API token and prints it once." v1 mints no deploy-time token; first-call auth is the account PAT. This removes the token-in-scrollback exposure the earlier draft accepted, at the cost of one extra command before the first `curl`.

## Validator Contract

The validator is the core of the protocol adoption loop: the spec's native adopter is a coding agent, and clear errors are the feedback loop.

**One implementation, two entrances.** `validate` is one server-side operation surfaced as (a) a generated CLI/CI command and (b) the mandatory pre-deploy check inside `mosoo deploy` and the console deploy — same rules, same messages, so "green in development, red in production" is structurally impossible. Offline local validation is a v1 non-goal.

**Doctor-style versioned output.** `validate` reports versioned, machine-stable JSON — `schemaVersion`, `failures[]` each with a stable `code`, `severity`, `file`, `field`, `problem`, and `action` — rendered human-readable in the terminal via the generated CLI's output hints. Stable codes are what let a coding agent repair a repo mechanically. Severity distinguishes `error`, `warning`, and `setup_required`.

> **Superseded** (decision map #17, earlier PRD draft): "MVP promises human-readable text only, no `--json`, no machine-readable schema." The CLI is generated from specs, so structured output is the native shape; the versioned validate result is now a committed contract. What remains uncommitted is the broader deployment *plan* preview schema.

Diagnostic requirements:

- Point to the exact file and field; say why the current value is illegal; give a repairable action.
- Missing credentials, OAuth, QR scan, token input, and similar setup work are `setup_required` — never misreported as schema errors. `validate` may report `setup_required`; `mosoo deploy` must stop on blocking `setup_required`.
- `validate` writes nothing: no resources, no tokens, no local state changes. It shows endpoint/Web preview facts and setup requirements.
- Validation can do convenience checks inside the protocol (e.g. web build sanity), but never guesses an arbitrary repo into a Mosoo app; a missing protocol file is an authoring error.

Illustrative diagnostics (codes are examples, locked in Phase 0):

```text
.agent/manifest.json: runtime is required.
.agent/.mcp.json: server "github" must not include plaintext token.
.agent/environment/definition.json: networkPolicy.allowedHosts must be an array of hostnames.
.mosoo.toml: spec must be "mosoo.spec.v1".
.mosoo.toml [expose.web]: agent "support" is not defined in .agent/.
.mosoo.toml [expose.channel]: channel exposure is not supported in the current MVP.
setup_required github: connect GitHub token after deploy.
```

> **Superseded** (earlier PRD draft, decision map #22): the preview verb was `mosoo deploy --dry-run`. The verb is now `validate` — first-class, CI-runnable, and identical to the pre-deploy check. `mosoo deploy` remains validate-plus-deploy.

## CLI Surface & Noun Parity

The CLI is generated Go (via Lathe) from Mosoo's exported OpenAPI/GraphQL specs in `mosoo-connector`; overlays contribute shortcuts, examples, `output_hints` JSON paths, and follow-up commands. No hand-written command output exists. Consequences:

- **Noun parity is a response-shape property.** The deploy nouns — endpoints, run number, commit, phases, next step — must live in the `deployApp` / run-status response shapes; the `deploy` overlay shortcut points `output_hints` at them, and `-o json` exposes the same fields to automation. The terminal block below is the *information contract* (which nouns responses carry), not a rendering promise:

```text
$ mosoo deploy
✓ validate            mosoo-native v1 · 3 agents · no web target
✓ provision agents    quiz-master v3→v4 · vet-advisor new · triage-helper unchanged
✓ activate endpoints  2 exposed

  API   https://<instance>/api/v1/apps/cat-quiz
        POST /agents/quiz-master/threads
        POST /agents/vet-advisor/threads
  key   mosoo tokens create
  run   #6 · commit e91f2ab
```

- `validate` and `deploy` are overlay additions beside today's generated shortcuts; the existing generated `mosoo console apps deploy-app` already maps to the mutation.
- The regenerated Mosoo Skill (`publish/skills/mosoo`, rebuilt on every connector build) is where the coding-agent journey is taught — "terminal teaches, console mirrors" lands in skill prose, not stdout formatting.
- Coordination per phase: mosoo spec export changes → connector build → skill republish.

## User Stories

1. As a coding-agent user, I want my coding agent to know exactly which Mosoo files to create, so that the generated repo can be deployed without product guesswork.
2. As a coding-agent user, I want Mosoo to fail when the repo is not Mosoo Native, so that I do not accidentally deploy an arbitrary project with wrong assumptions.
3. As a coding-agent user, I want a one-line `.mosoo.toml` marker for Agent-only repos, so that a minimal Agent can still be a valid Mosoo deployable.
4. As a coding-agent user, I want Agent behavior instructions to live in the Agent manifest, so that the Agent definition is not split across unnecessary files.
5. As a coding-agent user, I want one repo to declare multiple named Agents, so that a real Agent App can grow past the single-Agent happy path.
6. As a coding-agent user, I want `.agent/` to describe reusable Agent capability, so that the same Agent definition can later be imported, forked, or generated by App Builder.
7. As a coding-agent user, I want `.mosoo.toml` to describe repo-local deployment and exposure, so that build, Web binding, and host-layer decisions do not pollute Agent identity.
8. As a coding-agent user, I want deployable files to reject secrets, so that credentials do not leak into git history or coding-agent logs.
9. As a developer, I want `mosoo validate` to check files without writing resources, so that I can iterate safely before deployment.
10. As a developer, I want validate diagnostics to carry stable codes plus file, field, problem, and fix action, so that I can ask a coding agent to repair the repo mechanically.
11. As a developer, I want validate to distinguish schema errors from missing setup, so that credentials and OAuth issues are not mistaken for invalid files.
12. As a developer, I want `mosoo deploy` to mean validate plus deploy, so that the command matches the normal terminal meaning of deploy.
13. As a developer, I want dangerous or ambiguous deploys to fail fast, so that Mosoo does not hide uncertainty behind a confirmation prompt.
14. As a developer, I want repeated deploys from the same repo to update the same App, so that deployment is stable across iterations.
15. As a developer, I want first deploy to either create a new App or link to an explicit App, so that Mosoo never guesses by resource name.
16. As a developer, I want deploying an Agent to yield its API endpoint by default, so that I do not have to declare `[expose.api]`.
17. As a developer, I want Mosoo to show the App's OpenAPI URL after deploy, so that I can immediately wire external code to the Agent.
18. As a developer, I want the deploy output to point at the account PAT flow, so that my first call works without a new key-management surface.
19. As a developer, I want no tokens or secrets written to repo files or local deploy state, so that deploy convenience does not become stored secret leakage.
20. As a Web app builder, I want `[expose.web]` to bind a Web deployment to a named Agent, so that the hosted Web app can call the correct App-local Agent.
21. As a Web app builder, I want existing Web deployment resources to be reused where possible, so that Web deploy can build on current Mosoo AppDeployment concepts.
22. As an App owner, I want all deployed Agents and Web artifacts to stay under one App boundary, so that Threads, usage, logs, health, and resources roll up coherently.
23. As an App owner, I want Mosoo to preserve the rule that Agent owns runtime and exposure, so that no generic Service entity is introduced.
24. As an App owner, I want Channel Binding excluded from the first MVP, so that the team can ship the API namespace and Web deploy first.
25. As a future App Builder user, I want Mosoo Native files to be the builder output format, so that local coding-agent workflow and Mosoo-native authoring converge.
26. As an engineer, I want the v1 protocol to avoid alpha compatibility baggage, so that current `.mosoo.toml schema = 1` does not block the target shape.
27. As an engineer, I want validate output to be versioned and code-stable, so that coding agents and CI can consume it without scraping prose.
28. As an engineer, I want Web/API/Agent delivery not to become separate consoles, so that users experience deployment as one App workflow.
29. As an engineer, I want protocol errors to be stable enough for coding agents to repair, so that Mosoo Native adoption can happen through local agent feedback loops.
30. As a founder/operator, I want the one-month MVP to stay aggressively scoped, so that Mosoo ships a current Agent App deployment workflow instead of over-designing a generic platform.
31. As an API consumer, I want agents addressed by name under an app-scoped path, so that nothing id-shaped appears in anything I copy, share, or commit.
32. As a repo author, I want to define an agent without exposing it, so that internal helper agents deploy alongside exposed ones without gaining public endpoints.
33. As a repo author, I want the same repo to deploy green on a second Mosoo instance with zero edits, so that the artifact — not an instance — is the deliverable.
34. As an operator, I want each production version linked to the commit that produced it, so that provenance and rollback reasoning stay in git terms.

## Implementation Decisions

Protocol and files:

- Mosoo Native Deployable is the v1 deployment object. Mosoo Deploy only accepts repos intentionally authored against the protocol; no best-effort deployment for arbitrary repos.
- The public spec identifier is `mosoo.spec.v1`; every Native repo has a root `.mosoo.toml` declaring it. The current alpha `schema = 1` is an existing Web/App deployment override, not compatibility baggage — v1 requires a new parser/validator path.
- `.agent/` is an Agent Definition Set (one primary or multiple named Agents) owning identity, kind, runtime intent, model, behavior, Skills, MCP, and Environment requirements. Behavior instructions live in each Agent's `manifest.json`.
- `.mosoo.toml` owns the native marker and repo-local exposure: Web surface, target-Agent binding, per-agent expose subset, build/deploy overrides, host-layer configuration, setup requirements.
- Secrets do not belong in `.agent/`, `.mosoo.toml`, or `src/`; deployable files may only carry credential references, provider/setup mode, or post-deploy setup requirements.

Deployment semantics:

- Detection boundary: Native marker → protocol path; plain static/worker repos → existing generic detector; protocol repos never fall back. *(Recommended default; confirm at Phase 0 entry.)*
- One deploy upserts all repo-defined Agents (new/updated/unchanged) and auto-publishes them; deploy subsumes publish on the protocol path. The `.agent` package import name-resolution philosophy is the upsert engine.
- Publish remains an agent-level state flip (internal/secondary verb); the console Publish success surface presents the App-level deliverable.
- Commit SHA is version truth for repo-backed apps; per-agent DeploymentVersions are derived snapshots; console-authored apps keep publish-minted versions; running threads keep their snapshots.
- Console button, generated CLI, and later git webhook create the same DeploymentRun.
- CLI entrance binds the repo to one App via local deploy state (`orgId`/`appId`); explicit `--app` / `mosoo link` for existing Apps; no name-guessing across Apps/workspaces; missing binding, permission, or unique target fails fast. Local deploy state is outside the protocol and never stores secrets.
- `mosoo deploy` writes directly; no default confirmation, no `--yes` state machine; fail fast with a repair action on blocking setup, ambiguity, or danger.

Exposure and API:

- The App API is a name-addressed namespace: `…/api/v1/apps/{app-slug}/agents/{name}/threads`; the surface equals the per-agent expose subset; no ULID on consumer surfaces; no default-agent shorthand.
- Single-agent repos expose the primary Agent by default (no `[expose.api]`, ever); multi-agent repos declare per-agent exposure explicitly in `.mosoo.toml`. *(Confirm exact rule and TOML shape at Phase 0 entry.)*
- `[expose.web]` is the v1 Web deployment entry and can bind a target Agent so the hosted Web app calls the correct App-local Agent. Current `[[agents]] expose = "public_thread"` is an implementation anchor, not v1 syntax — v1 must not teach two exposure languages.
- `[expose.channel]` is a target protocol surface, excluded from the one-month MVP; it does not block the API namespace or Web deploy.
- The App owns namespace, OpenAPI document, and quota — not an App-level runtime endpoint. App remains the product boundary; Agent remains the App-local runtime and delivery unit; no generic Service entity; no `app.type` driving runtime, access, or ownership.
- Web deployment reuses the App-owned Deployment / DeploymentRun concept and is not App runtime.
- Slug stability is the API compatibility promise; minting/rename policy is an open decision.

Access:

- v1 auth is account PATs (`mosoo tokens create` / `auth login`); no deploy-time token minting (**Superseded**: one-time visible Agent API token). App-scoped keys deferred; per-agent key restrictions deferred.

Validator and CLI:

- `validate` is one server-side operation with two entrances (generated CLI/CI command; mandatory pre-deploy check) — same rules, same messages. Offline local validation is a non-goal.
- Validate output is doctor-style versioned JSON (`schemaVersion`, stable `failures[].code`/`severity`/`file`/`field`/`problem`/`action`), rendered readable via overlay output hints (**Superseded**: text-only, no `--json`). The broader deploy-plan preview schema stays uncommitted.
- `setup_required` is a first-class severity distinct from schema errors; blocking `setup_required` stops `mosoo deploy` but not `validate`.
- The CLI is generated (Lathe, mosoo-connector); deploy nouns live in `deployApp`/run-status response shapes; `deploy` and `validate` ship as overlay additions; the regenerated Mosoo Skill teaches the journey.

Instance boundary:

- The only instance prerequisites are provider credentials and the org/app shell; everything else travels in the artifact; secrets never travel. The thesis metric is the portability SLO: % of protocol-valid repos deploying green, unmodified, on an instance they have never touched.
- The short-term authoring surface is Codex, local coding agents, Mosoo Skill, and Mosoo CLI; the long-term authoring surface is Mosoo App Builder, with Native files as its output format.

## Testing Decisions

- The highest test seam is the Native deploy workflow: given a repo fixture, run validate or deploy, then assert externally visible diagnostics, preview facts, created/updated resources, and response-shape nouns.
- Validator tests assert the user-visible contract: missing `.mosoo.toml`, wrong spec, missing manifest, missing multi-agent target, secrets in MCP/environment files, unsupported Channel exposure, Web target agent not found — and now also the versioned JSON contract itself: `schemaVersion` presence and failure-code stability across releases.
- Validate tests must prove nothing is written: no resources, no tokens, no local-state change, while preview facts and setup requirements are shown.
- Deploy tests must prove successful validation upserts all repo-defined Agents (new / updated / unchanged), auto-publishes them, activates name-addressed endpoints under the app namespace, exposes exactly the declared subset (internal agents get no public route), outputs the OpenAPI URL, and persists no token anywhere.
- Portability tests are the thesis: a fixture repo deployed on a second, fresh instance (provider creds + app shell only) must go green with zero edits; `deployment_agent_not_found` must be unreachable from the protocol path.
- Resource reuse tests cover same-App updates via local binding, create/link without a binding, fail-fast on multiple candidates or missing permission, and the ban on name guessing.
- Web exposure tests cover `[expose.web]` against primary and named Agents, and conversion into Web deployment plus Agent-binding capability.
- Version provenance tests: repo-backed deploys record commit SHA on the run and derived per-agent snapshots; console publishes keep minting versions.
- The demo is the acceptance test: the happy-path storyboard beats run as deterministic e2e (extending the fixture-backed `/v0-deploy-preview` pattern); a red beat blocks release like a failed test.
- Existing tests for the App deployment detector, AppDeployment / DeploymentRun, deploy mutation, Public Thread API / OpenAPI, and Agent binding resolution are the closest prior art; attach to those seams instead of overfitting v1 parser internals.
- Channel Binding is not an MVP gate: fixtures may exist, but MVP asserts an unsupported / setup_required / not-in-scope result.

## Out of Scope

- Generic Railway / Nixpacks-style arbitrary-repo detection on the protocol path (plain repos keep the existing detector per the boundary rule).
- `mosoo up` as the user-facing primary command; v1 uses deploy semantics.
- `[expose.api]`.
- MVP implementation of Channel Binding / `[expose.channel]`, and automatic setup for external Channel credentials, OAuth flows, QR scans, or bot installation.
- Default confirmation, a `--yes` state machine, or semi-automatic confirmation for dangerous operations.
- A committed machine-readable deployment *plan* schema (the validate failure contract IS committed; the plan preview is not).
- Offline local `validate` (one server-side implementation, two entrances).
- Deploy-time token minting, App-scoped API keys (v1 rides account PATs), and per-agent key restrictions under an App key.
- A default-agent shorthand route (`…/apps/{slug}/threads`).
- Auto-redeploy on push, custom domains, per-branch previews (post-v1 pipeline features).
- Automatic migration of existing console-created agents into repos.
- Complex resource reuse, cross-workspace/name matching, automatic drift detection.
- Expanding `.agent` package into a complete App package.
- Generic Service entity, `services` table, or polymorphic `service.kind`.
- App runtime, App-level API endpoint, or old Publish App semantics.
- Full App Builder implementation (only the output-format alignment matters now).
- Multi-user organization governance, member permission matrix, enterprise SSO/SCIM, cross-account resource governance.
- Long-term compatibility for alpha `.mosoo.toml schema = 1` or old manifest shapes.
- Market, community, or fork-distribution surfaces (owned by the market decision map; their technical precondition is the portability SLO).

## Current Implementation Mapping

| Capability | Current state | Evidence anchor |
| --- | --- | --- |
| Agent Manifest / `.agent` package | Single-Agent package contract exists; not yet a multi-Agent repo source protocol | `pkgs/contracts/src/agent/*`, `pkgs/agent-package/src/*` |
| Package portability philosophy (strip ids, resolve by name, blank secrets) | Exists in package export/import — not called by the deploy pipeline | `agent-package-export.service.ts:26`, `agent-package-import.service.ts:31` |
| Environment / MCP sidecars | Package sidecar/ref constraints exist | `pkgs/agent-package/src/archive-*-sidecar.ts` |
| Public Thread API / OpenAPI / PAT | Exists; currently ULID-addressed per agent | `pkgs/contracts/src/http/*`, `apps/api/src/modules/public-api/*`, `public-api-route.ts:111` |
| AppDeployment / AppDeploymentRun / `deployApp` | Exists for Web artifacts | `apps/api/src/modules/apps/application/app-deployment*.ts` |
| `.mosoo.toml schema = 1` detector | File-allowlist snapshot + `[[agents]]` name-binding to pre-existing published agents — the mechanism the protocol replaces | `app-deployment-executor.service.ts:83`, `app-deployment-detector.ts:789`, `app-agent-binding-resolution.ts:41` |
| Publish verb (state flip + version mint) | Exists agent-level | `agent-lifecycle-command.service.ts:40` |
| Capability URL per (App, Agent) | Exists; requires published agent — resolution target becomes repo-upserted agents | `app-agent-capability.ts:27` |
| Generated CLI + Skill (Lathe) | Exists in `mosoo-connector`; `deploy`/`validate` overlays are the additions | connector `9bc9644` |
| `spec = "mosoo.spec.v1"` parser, validate service, upsert, namespace routes | Target protocol, not implemented | this PRD |

## Coding Agent Instruction

One-page instruction draft (ships via the regenerated Mosoo Skill):

```markdown
To make this project deployable on Mosoo, produce Mosoo Native files.
Mosoo deploys repositories that intentionally follow the Mosoo Native Deployment Protocol; do not rely on generic framework detection.

Create `.agent/manifest.json` to describe the primary Agent: identity, runtime, model, kind, and behavior instructions.
If the project needs multiple Agents, create named Agent definitions and point each expose surface at the correct Agent.
Put reusable skills under `.agent/skills/`.
Put MCP server definitions in `.agent/.mcp.json`; never write secrets.
Put environment packages, setup, and network policy in `.agent/environment/definition.json`.
Create root `.mosoo.toml` with `spec = "mosoo.spec.v1"`. Add Web deploy configuration or Web-to-Agent binding there only when needed. Do not declare `[expose.api]`; exposed Agents get name-addressed endpoints under the App namespace by default. Do not create Channel exposure in the current MVP.

Run `mosoo validate` before finishing. Fix every reported failure code, file, and field until green.
```

## Open Decisions

1. **App slug minting and rename policy** (owner: PM; blocks namespace GA). The slug is in every API path, so slug stability is the compatibility promise. Recommended: mint from manifest name, immutable once any agent is exposed; renames require a new App or an explicit redirect window. Needs a decision before Phase 2.
2. **Exposure default rule** (confirm at Phase 0 entry). Recommended above: single-agent → primary exposed by default; multi-agent → explicit per-agent declaration. Plus the exact `.mosoo.toml` field shape.
3. **Detection boundary** (confirm at Phase 0 entry). Recommended default: marker → protocol path; plain repos → existing generic detector.
4. **Does console Publish materialize the repo in v1** (export/push to GitHub) or only guarantee shape-conformance with export on demand? Gates Phase 4 / Path B only.

Video-staging questions (second-instance choice, on-screen key setup) stay in the happy-path doc; they do not affect this contract.

## Further Notes

The core choice in this PRD is to put Mosoo's narrow waist at Agent/session/delegation, not process hosting. Railway asks how to build, how to start, and whether to expose a port. Mosoo Native asks how the Agent is equipped, how delegation enters, where results are delivered, and how the process is recorded and operated.

The one-month MVP loop: a coding agent (via Mosoo Skill) writes Native files; `mosoo validate` gives repairable, code-stable feedback; deploy — console paste or `mosoo deploy` — upserts the repo's Agents and activates name-addressed endpoints; the user receives the namespace URL, OpenAPI URL, and a PAT pointer, plus a Web URL when declared. The same repo then deploys on a second instance unchanged: that recording is the product thesis ("one repo, any Mosoo"), and the happy-path doc owns its storyboard and acceptance beats.

This PRD does not replace App Boundary, Agent Manifest, Runtime Session Kernel, Public Thread API, or App Deployment PRDs. It is the repo-level deployable contract layered on top of those existing contracts; where older PRDs describe name-binding to pre-existing published agents or ULID-addressed consumer endpoints, this PRD supersedes them.

> Minimal product sentence: Mosoo lets coding agents produce deployable Agent Apps by following a native file protocol, then turns those files into deployed Agents with name-addressed API endpoints and, when needed, hosted Web deployments — on any Mosoo instance, from the same repo.
