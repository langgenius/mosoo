# Mosoo Native Deployment Protocol PRD

Status: draft implementation contract.

This PRD synthesizes five current product artifacts: the Agent App market decision map, the Mosoo Native Deployment Protocol draft, and three accepted ADRs. It describes the target product contract. It does not claim that every capability below already exists in the current implementation.

## Problem Statement

Mosoo's target users will ask Codex, a local coding agent, or a future Mosoo App Builder to produce a deployable repository. Mosoo currently lacks a stable repo-level contract that tells the coding agent which files define Agents, which files define deployment exposure, how validation works, how deployment happens, and what output the user should receive after deployment.

If Mosoo becomes a generic repo detector, it falls back into Railway / Nixpacks-style process hosting: scan the language ecosystem, infer build/start/port behavior, and try to run arbitrary code. That layer is already commoditized, and it does not expose the Agent/session/delegation lifecycle that Mosoo needs to productize.

If Mosoo asks users to pick hard application types such as API Agent, Channel Agent, Web Agent, or Digital Employee, it creates the wrong mental model. Users and coding agents need one deployable contract: how the Agent is equipped, how one delegation is accepted, where requests enter, and where results are delivered.

## Solution

Define Mosoo Native Deployment Protocol v1. A repo must be intentionally authored as a Mosoo Native Deployable before Mosoo deploys it. Mosoo does not guess arbitrary repos and does not ask the user to choose a hard business type. It reads standard files, validates them, and turns the repo into Agents inside one App, App-local resources, Agent API Endpoints, and optional Web deployments.

The minimum v1 repo marker is a root `.mosoo.toml`:

```toml
spec = "mosoo.spec.v1"
```

Agent definitions live in `.agent/`. Deployment and exposure configuration lives in `.mosoo.toml`. Secrets never live in deployable files. They can only appear as Mosoo credential setup, credential references, or post-deploy setup requirements.

The first MVP user path is: a coding agent writes Mosoo Native files; the user runs `mosoo deploy --dry-run` to see validation and preview output; after the files are deployable, the user runs `mosoo deploy` to deploy. After success, every deployed Agent outputs an Agent API Endpoint, an OpenAPI URL, and a one-time visible Agent API token. If the repo declares Web exposure, Mosoo also outputs a Web deployment URL.

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

- `.agent/agents/<agent-name>/manifest.json` is used when the repo declares multiple named Agents.
- `.agent/skills/` carries reusable Skills referenced by Agent manifests.
- `.agent/.mcp.json` carries MCP server intent and must not contain plaintext credentials.
- `.agent/environment/definition.json` carries Environment requirements and must not contain secret values.

The minimum Agent-only repo is:

```text
my-repo/
├── .agent/
│   └── manifest.json
└── .mosoo.toml
```

The minimum `.mosoo.toml` for that repo is:

```toml
spec = "mosoo.spec.v1"
```

A multi-Agent repo can use named Agent manifests:

```text
my-repo/
├── .agent/
│   ├── manifest.json
│   └── agents/
│       ├── support/
│       │   └── manifest.json
│       └── triage/
│           └── manifest.json
└── .mosoo.toml
```

A Web repo that calls a named Agent can declare Web exposure in `.mosoo.toml`:

```toml
spec = "mosoo.spec.v1"

[expose.web]
agent = "support"
build = "npm run build"
```

Boundary rules:

- `.agent/` defines reusable Agent identity and capability. It does not define repo-local deployment exposure.
- `.mosoo.toml` defines repo-local deployment exposure. It does not define who the Agent is.
- `src/` contains hosted application code only when needed. Agent-only repos do not need `src/`.
- Secrets never belong in `.agent/`, `.mosoo.toml`, or `src/` as protocol data.
- Existing `.agent` package contracts are the current single-Agent package anchor. Multi-Agent repo layout is target v1 source structure and still needs implementation.

## User Stories

1. As a coding-agent user, I want my coding agent to know exactly which Mosoo files to create, so that the generated repo can be deployed without product guesswork.
2. As a coding-agent user, I want Mosoo to fail when the repo is not Mosoo Native, so that I do not accidentally deploy an arbitrary project with wrong assumptions.
3. As a coding-agent user, I want a one-line `.mosoo.toml` marker for Agent-only repos, so that a minimal Agent can still be a valid Mosoo deployable.
4. As a coding-agent user, I want Agent behavior instructions to live in the Agent manifest, so that the Agent definition is not split across unnecessary files.
5. As a coding-agent user, I want one repo to declare multiple named Agents, so that a real Agent App can grow past the single-Agent happy path.
6. As a coding-agent user, I want `.agent/` to describe reusable Agent capability, so that the same Agent definition can later be imported, forked, or generated by App Builder.
7. As a coding-agent user, I want `.mosoo.toml` to describe repo-local deployment and exposure, so that build, Web binding, and host-layer decisions do not pollute Agent identity.
8. As a coding-agent user, I want deployable files to reject secrets, so that credentials do not leak into git history or coding-agent logs.
9. As a developer, I want `mosoo deploy --dry-run` to validate files without writing resources, so that I can iterate safely before deployment.
10. As a developer, I want dry-run diagnostics to point to file, field, problem, and fix action, so that I can ask a coding agent to repair the repo.
11. As a developer, I want dry-run to distinguish schema errors from missing setup, so that credentials and OAuth issues are not mistaken for invalid files.
12. As a developer, I want `mosoo deploy` to mean validate plus deploy, so that the command matches the normal terminal meaning of deploy.
13. As a developer, I want dangerous or ambiguous deploys to fail fast, so that Mosoo does not hide uncertainty behind a confirmation prompt.
14. As a developer, I want repeated deploys from the same repo to update the same App, so that deployment is stable across iterations.
15. As a developer, I want first deploy to either create a new App or link to an explicit App, so that Mosoo never guesses by resource name.
16. As a developer, I want Agent API Endpoint to be the default output of deploying an Agent, so that I do not have to declare `[expose.api]`.
17. As a developer, I want Mosoo to show an OpenAPI URL after deploy, so that I can immediately wire external code to the Agent.
18. As a developer, I want Mosoo to create a one-time visible Agent API token after deploy, so that I can immediately call the endpoint.
19. As a developer, I want deploy tokens to never be written to repo files or local deploy state, so that deploy convenience does not become stored secret leakage.
20. As a Web app builder, I want `[expose.web]` to bind a Web deployment to a named Agent, so that the hosted Web app can call the correct App-local Agent.
21. As a Web app builder, I want existing Web deployment resources to be reused where possible, so that Web deploy can build on current Mosoo AppDeployment concepts.
22. As an App owner, I want all deployed Agents and Web artifacts to stay under one App boundary, so that Threads, usage, logs, health, and resources roll up coherently.
23. As an App owner, I want Mosoo to preserve the rule that Agent owns runtime and exposure, so that no generic Service entity is introduced.
24. As an App owner, I want Channel Binding excluded from the first MVP, so that the team can ship Agent API Endpoint and Web deploy first.
25. As a future App Builder user, I want Mosoo Native files to be the builder output format, so that local coding-agent workflow and Mosoo-native authoring converge.
26. As an engineer, I want the v1 protocol to avoid alpha compatibility baggage, so that current `.mosoo.toml schema = 1` does not block the target shape.
27. As an engineer, I want validator output to stay human-readable in MVP, so that the team does not prematurely commit to a machine-readable deploy plan schema.
28. As an engineer, I want Web/API/Agent delivery not to become separate consoles, so that users experience deployment as one App workflow.
29. As an engineer, I want protocol errors to be stable enough for coding agents to repair, so that Mosoo Native adoption can happen through local agent feedback loops.
30. As a founder/operator, I want the one-month MVP to stay aggressively scoped, so that Mosoo ships a current Agent App deployment workflow instead of over-designing a generic platform.

## Implementation Decisions

- Mosoo Native Deployable is the v1 deployment object. Mosoo Deploy only accepts repos intentionally authored against Mosoo Native Deployment Protocol. It does not do best-effort deployment for arbitrary repos.
- The public spec identifier is `mosoo.spec.v1`. Every Mosoo Native repo must have a root `.mosoo.toml` with `spec = "mosoo.spec.v1"`.
- The current alpha `.mosoo.toml schema = 1` is an existing Web/App deployment override, not long-term compatibility baggage. Implementing v1 requires a new parser / validator path that accepts `spec = "mosoo.spec.v1"`.
- `.agent/` is an Agent Definition Set. It can represent one primary Agent or multiple named Agents.
- Agent behavior instructions live in the relevant Agent's `manifest.json`. v1 does not introduce a separate instructions file.
- `.agent/` owns reusable Agent identity and capability: identity, kind, runtime intent, model, behavior, Skills, MCP, and Environment requirements.
- `.mosoo.toml` owns repo-local native marker and deployment exposure: Web surface, target-Agent binding, binding names, build/deploy overrides, host-layer configuration, and setup requirements.
- Secrets do not belong in `.agent/` or `.mosoo.toml`. Deployable files may only contain credential references, provider/setup mode, or post-deploy setup requirements.
- Agent API Endpoint is the default output for every deployed Agent. It does not require `[expose.api]`.
- After `mosoo deploy` succeeds, Mosoo outputs the Agent API Endpoint, OpenAPI URL, and a newly created one-time visible Agent API token.
- `mosoo deploy --dry-run` does not create a token and does not create or update resources. It only outputs validator diagnostics and deployment preview facts.
- Tokens are not written to the repo, `.mosoo.toml`, or local deploy state. Terminal output must clearly mark the token as secret and only visible once.
- The MVP accepts the risk that the token may appear in terminal scrollback, shell transcripts, or coding-agent logs in exchange for the shortest first-call path. Token management, `--no-token`, and finer-grained token commands are future work.
- `[expose.web]` is the v1 Web deployment entry. It can specify a target Agent so that Mosoo injects the ability for the Web app to call an Agent inside the same App.
- Current `[[agents]] expose = "public_thread"` is an implementation anchor, not v1 target syntax. v1 must not teach coding agents two exposure languages.
- `[expose.channel]` is a target protocol surface, but it is not part of the one-month MVP. Channel Binding does not block Agent API Endpoint or Web deploy.
- `mosoo deploy --dry-run` is the preview entry. `mosoo deploy` is the validate plus deploy entry. The MVP does not introduce default confirmation or require `--yes`.
- If blocking setup is missing, the target is ambiguous, or the operation would be dangerous, `mosoo deploy` must fail fast with a repair action.
- The current repo is bound to one Mosoo App through local deploy state. Future deploys from that repo only update resources inside that App.
- First deploy without a binding can create a new App or bind to an existing App through an explicit App target or link flow.
- Local deploy state records target identity such as org/app binding. It is not part of Mosoo Native Protocol and must not store secrets.
- Mosoo must not guess resource reuse by name across Apps or workspaces. Missing binding, missing permission, or non-unique targets must stop deployment.
- The MVP validator only promises human-readable text output. It does not provide `--json` and does not commit to a stable machine-readable deployment plan schema.
- Validator diagnostics must include severity, file, field, problem, and fix action. They must distinguish `error`, `warning`, and `setup_required`.
- Missing credentials, OAuth, QR scan, token input, and similar setup work are `setup_required`. They must not be reported as schema errors.
- App remains the product and engineering boundary. Agent remains the App-local runtime and delivery unit. v1 does not introduce a generic Service entity and does not use `app.type` to drive runtime, access, or ownership.
- Web deployment reuses the App-owned Deployment / DeploymentRun product concept, but it must not be interpreted as App runtime or an App-level API endpoint.
- Public Thread API / Agent API Endpoint is the implementation anchor for Agent exposure. The Native deploy gap is CLI output, token creation wiring, and orchestration from Native files to App-local Agents and exposures.
- The short-term authoring surface is Codex, local coding agents, Mosoo Skill, and Mosoo CLI. The long-term authoring surface is Mosoo App Builder.

## Testing Decisions

- The highest test seam is the Native deploy workflow: given a repo fixture, run dry-run or deploy action, then assert externally visible diagnostics, preview facts, created/updated resources, and output text.
- Validator tests should assert the user-visible contract, not internal parser shape. Key coverage: missing `.mosoo.toml`, wrong spec, missing manifest, missing multi-agent target, secrets in MCP/environment files, unsupported Channel exposure, and Web target agent not found.
- Dry-run tests must prove that no resources are written, no token is created, and local deploy state is unchanged, while endpoint/Web preview facts and setup requirements are still shown.
- Deploy tests must prove that successful validation creates or updates App-local Agents, makes Agent API Endpoint available, outputs OpenAPI URL, creates a one-time token, and does not persist the token into protocol files or local state.
- Resource reuse tests must cover updating the same App with an existing local App binding, create/link behavior without a binding, fail-fast behavior for multiple candidates or missing permission, and the ban on name guessing.
- Web exposure tests must cover `[expose.web]` pointing to both a primary Agent and a named Agent, and must verify conversion into Web deployment plus Agent binding capability.
- Existing tests for App deployment detector, AppDeployment / DeploymentRun, deploy mutation, Public Thread API / OpenAPI, and Agent binding resolution are the closest prior art. New tests should attach to those product seams where possible instead of overfitting low-level v1 parser internals.
- Do not write `--json` / structured plan compatibility tests for the MVP because structured output is not promised by this PRD.
- Channel Binding is not an MVP release gate. Target protocol fixtures may exist, but the MVP must assert an unsupported / setup_required / not-in-scope result.
- E2E posture: first release needs at least one terminal-level happy path smoke that covers coding-agent generated files, dry-run, deploy, and calling the Agent API with the output endpoint/token. A complex Web hosting build matrix is not a first-release gate.

## Out of Scope

- Generic Railway / Nixpacks-style arbitrary repo detection.
- `mosoo up` as the user-facing primary command; v1 uses deploy semantics.
- `[expose.api]`.
- MVP implementation of Channel Binding / `[expose.channel]`.
- Default confirmation, a `--yes` state machine, or semi-automatic confirmation for dangerous operations.
- `--json` dry-run output and stable machine-readable deployment plan schema.
- Complex resource reuse, cross-workspace/name matching, and automatic drift detection.
- Automatic setup for every external Channel credential, OAuth flow, QR scan, or bot installation.
- Expanding `.agent` package into a complete App package.
- Generic Service entity, `services` table, or polymorphic `service.kind`.
- App runtime, App-level API endpoint, or old Publish App semantics.
- Full App Builder implementation. Mosoo Native v1 only needs to keep the future App Builder output direction aligned.
- Multi-user organization governance, member permission matrix, enterprise SSO/SCIM, and cross-account resource governance.
- Long-term compatibility design for alpha `.mosoo.toml schema = 1` or old manifest shapes.

## Further Notes

The core choice in this PRD is to put Mosoo's narrow waist at Agent/session/delegation, not process hosting. Railway asks how to build, how to start, and whether to expose a port. Mosoo Native asks how the Agent is equipped, how delegation enters, where results are delivered, and how the process is recorded and operated.

The one-month MVP loop is: Mosoo Skill / coding agent writes Native files; `mosoo deploy --dry-run` gives repairable feedback; `mosoo deploy` deploys; the user receives Agent API Endpoint / OpenAPI / token. If Web exists, the user also receives a Web URL. Web and Agent API have current implementation anchors. Channel Binding stays out of the first release.

This PRD does not replace App Boundary, Agent Manifest, Runtime Session Kernel, Public Thread API, or App Deployment PRDs. It is the repo-level deployable contract layered on top of those existing contracts.
