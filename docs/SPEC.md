# Mosoo Spec

Status: active product and engineering spec for the current MVP.

This document defines the nouns, relationships, boundaries, and required behavior for the
current Mosoo App pivot. It is not a vision, pitch, or strategy document. It should
let a new engineer understand what to build without inferring product meaning from older
Agent-first, Web-app-first, or Organization-governance language.

If this document conflicts with older PRDs, follow this document first, then
`docs/prd/app-boundary.md`, then `docs/architecture.md`.

## Design Principles

1. App is the user-facing product boundary.
2. App is the engineering name for the same boundary.
3. App is the ownership and console boundary for Agents and resources, and may own one external Vibe App.
4. Organization is only the account, billing, tenant, and future-governance shell.
5. App owns concrete App-local concepts directly; V1 does not introduce a generic
   Service entity.
6. App has no runtime. Runtime belongs to Agents or future explicitly named runtime
   resources.
7. Agent is the App-local unit that owns Agent runtime and delivery.
8. Thread is the product name for an Agent Session in V1.
9. App resources are owned at App scope; Agents bind the resources they need.
10. V1 optimizes for delivery and reuse, not administration.
11. Owner-only access is the default for V1.
12. Future governance must not block the single-owner App loop.

## Core Concepts

### Account

An Account is a human login identity.

An Account:

- Authenticates with supported login methods.
- Owns exactly one Organization during the V1 single-owner phase.
- Is the execution owner for App resources created in that Organization.

### Organization

An Organization is the tenant shell.

An Organization:

- Contains Apps.
- Has one human owner in V1.
- Owns billing rollups and future governance settings.
- Must not be used as the default bucket for business resources.

An Organization does not have V1 members, roles, invitations, access requests, ownership
transfer, SAML, SCIM, domain discovery, or Organization-owned runtime resource pools.

### App

An App is the canonical product and engineering boundary.

An App:

- Belongs to one Organization.
- Has one owner Account in V1.
- Is what the user creates, opens, configures, and monitors.
- Is a boundary for a real-world Agent application.
- Organizes one or more App-local Agents.
- Owns concrete resources that those Agents can bind.
- Is the primary database, API, and test boundary.
- Aggregates Threads, usage, health, logs, and expose state through its Agents and
  resources.
- May own one Vibe App built through the platform's VibeSDK backend.
- Is the default console entry after onboarding when the Organization has one App.

An App does not itself execute Agent runtime and does not become the published
Vibe App's runtime process. Its Vibe App is a separately modeled, App-owned
external Web artifact with its own preview and production URLs.

### Agent

An Agent is an App-local execution and delivery unit.

An Agent:

- Belongs to one App.
- Has a runtime kind such as Pet or Cattle.
- References one Environment.
- May bind App-owned Skills, MCP servers, and Channels, and resolves App-owned
  Provider credentials at runtime.
- Owns runtime execution.
- Owns API endpoint exposure when exposed.
- Owns channel delivery when bound to a Channel.
- Owns Threads/Sessions in V1.

"Agent Service" is discussion language for this same entity. It is not a separate V1
entity, table, service layer, or product container.

An App can contain many Agents, but one Agent per App is expected to be common.

### Generic Service Entity

V1 does not have a generic Service domain entity.

Rules:

- Do not add a unified `services` table.
- Do not model App resources through a polymorphic `service.kind`.
- Do not create generic Service CRUD as the primary API for Agents, Channels, Files,
  Environments, Skills, MCP servers, or Provider credentials.
- Console copy may group concrete resources under "Services" or "Resources" for scanning,
  but that grouping must not become a database, API, permission, or lifecycle boundary.
- If a future resource shares a deployment/runtime lifecycle, such as Web/API runtime,
  database service, scheduled job, or worker process, model it with an explicit noun and
  add a dedicated contract for its lifecycle.
- API-layer names such as File Service or Environment Service are implementation modules
  and do not imply a generic Service domain entity.

### Vibe App

A Vibe App is the App-owned external web application built, previewed, and
published through a Mosoo-operated VibeSDK instance.

A Vibe App:

- Belongs to one App; the current product supports zero or one Vibe App per
  App.
- Is created from a natural-language prompt and iterated with follow-up
  prompts; the VibeSDK builder owns generation, validation, and repair.
- Runs a live sandbox preview during development and publishes to
  Mosoo-managed Workers for Platforms for its production URL.
- Is operated from App Overview, including create, prompt, preview, publish,
  source export, and delete.
- Is not Agent runtime, an Agent Deployment Version, an App-level API endpoint,
  or a generic Service runtime.

Build and publish state lives on the VibeSDK instance; Mosoo stores only the
App-to-Vibe-App binding and reads status live.

### Thread

A Thread is the user-facing name for an Agent Session.

A Thread:

- Is created against one Agent in V1.
- Is shown in the App console as part of the App's aggregated interaction history.
- Can be created from Mosoo WebUI, Public Thread API, or channel delivery.
- Is the replayable product record of an Agent interaction.

V1 does not have an App-level multi-Agent Thread entity. A future orchestration layer may
allow one Thread to target multiple Agents, but that is not the current model.

### Session

A Session is the implementation and runtime boundary behind a Thread.

A Session:

- Belongs to one Agent in V1.
- Inherits App through that Agent.
- Stores conversation history, runtime events, files attached to the Session, and run
  state.
- Freezes the Agent execution snapshot when it is created.

When product copy says Thread, code and database may still say Session.

### Session Run

A Session Run is one execution attempt inside a Session.

A Session Run:

- Belongs to one Session.
- Records the Agent, deployment version, runtime, provider, model, trigger, status,
  events, and usage for that execution.
- Is the right place to track retries, failures, interrupts, and run-level attribution.

### Environment

An Environment is an App-local runtime template.

An Environment:

- Belongs to one App.
- Defines packages, setup script, environment variables, network policy, and allowed hosts.
- Has immutable revisions.
- Is frozen into a Session execution snapshot when a Session starts.
- Can be selected by one or more Agents.

Current enforcement is partial: Runtime installs declared packages through the
generated setup script, runs the custom setup script, and injects environment
variables. Network policy, allowed hosts, and the MCP / package-manager allow
flags are persisted and frozen intent only; they are not currently carried into
Runtime enforcement and must not be treated as a security boundary.

Organization default environments and admin compliance overrides are migration or future
governance concepts.

### Files

Files is the current App-level read surface over file records plus the shipped
session-scoped attachment/artifact flows. Existing Space naming is pre-launch
legacy and should be removed rather than preserved as a compatibility layer.

Files:

- Belongs to the current App access boundary.
- Stores file objects and metadata for shipped Session and internal flows.
- Supports session-scoped attachments/artifacts. The schema and service contain
  an App `library` scope and versioning primitives, but no current user-facing
  library create/upload mutation or button; the Files page is list/download only.
- Does not promote runtime artifacts into the dormant App library scope.
- Is not the product model for generated application source trees, deployable projects, or App asset publishing.

Vibe App source lives on the VibeSDK instance and exports over its git clone
URL. Files does not become a generated source tree or deployment artifact
store.

### Skill

A Skill is an App-local capability package that can be attached to an Agent.

A Skill:

- Belongs to one App.
- Has metadata and package content.
- Can be selected by one or more Agents.
- Is resolved at Agent or Session execution time according to Agent bindings.

Org-wide skill libraries, coworker sharing, and per-user skill toggles are not V1 concepts.

### MCP Server

An MCP Server is an App-local tool connector definition.

An MCP Server:

- Belongs to one App.
- Has a URL, auth shape, metadata, and credential policy.
- Can be bound to one or more Agents.
- Resolves credentials at runtime from App-owned secrets.

Organization-shared MCP servers and service-account governance are future concepts.

### Provider Credential

A Provider Credential is an App-owned model or runtime provider secret.

A Provider Credential:

- Belongs to one App.
- Is stored through the secret vault.
- Can be referenced by one or more Agents.
- Is resolved for the Agent execution owner.

Company credential pools, per-member BYOK, and org-wide provider administration are not V1
concepts.

### Channel

A Channel is an App-owned external delivery resource, such as Slack, Lark, Discord,
Telegram, WeChat, or another messaging surface.

A Channel:

- Belongs to one App.
- Stores provider identity, credentials, connection state, and provider metadata.
- Its current provider/tenant/bot connection binds exactly one Agent. Reassignment removes or
  replaces that binding; one external Channel connection is not shared by multiple Agents.
- Does not create a generic Interface entity in V1.

An Agent's channel binding or delivery exposes that Agent through a Channel.

### Agent API Endpoint

An Agent API Endpoint is an Agent-owned public access surface.

An Agent API Endpoint:

- Belongs to one Agent.
- Creates or continues Threads/Sessions for that Agent.
- Uses App-owned credentials, usage rollups, and operations visibility.

There is no V1 App-level API endpoint.

### Agent Exposure

Agent Exposure is the act of making an Agent callable through an API endpoint or Channel.

Agent Exposure:

- Belongs to one Agent.
- May create a stable endpoint, token, channel delivery route, or published Agent version.
- Is summarized by the App but not owned by an App runtime.

Publishing an Agent and publishing a Vibe App are separate actions. Agent publishing creates the
live Agent version used by future Threads. Publishing a Vibe App ships an external Web artifact
and does not create Agent runtime or an App-level API endpoint.

## Relationships

```text
Account
+-- Organization
    +-- App
        +-- Agents
        |   +-- Threads / Sessions
        |   |   +-- Session Runs
        |   +-- Agent API Endpoint exposure
        |   +-- Channel delivery bindings
        +-- Files
        +-- Environments
        +-- Skills
        +-- MCP Servers
        +-- Provider Credentials
        +-- Channels
        +-- Gateways / exposure surfaces
        +-- Vibe App
        |   +-- preview URL
        |   +-- Mosoo-owned production URL
        +-- Operations
        |   +-- usage
        |   +-- Agent logs
        |   +-- Vibe App activity
```

Rules:

- Organization owns Apps, not App resources directly.
- App is the product, database, API, and console boundary.
- App owns business resources, the Vibe App, and operations scope.
- App has no runtime.
- Agents own Agent runtime, endpoint exposure, channel delivery, and Threads/Sessions in V1.
- Thread is a product name for Agent Session in V1.
- Usage has App as the business dimension and Organization as the billing rollup.
- V1 has no unified `services` table or generic Service lifecycle.

## V1 Goals

V1 must support:

- A personal developer signs in.
- The system creates or selects the developer's Organization shell.
- The system creates a default App.
- The user can start from a blank App.
- The user can create or configure one or more concrete App resources.
- The user can create or configure one or more Agents when the App needs runtime.
- The Agent can reference an Environment.
- The Agent can use App-local Provider credentials.
- The Agent can bind App-local Skills, MCP servers, and Channels when configured.
- The user can create Threads for an Agent from Mosoo WebUI.
- The user can expose an Agent through an API endpoint.
- The system can map channel external threads to Agent Sessions when Channel delivery is
  configured.
- The user can inspect App-scoped Agents, configuration resources, Runs / Threads, App usage,
  Agent logs, and Agent exposure state.
- The user can create, prompt, preview, publish, and delete one App-owned Vibe App from App
  Overview.

## Non Goals

V1 must not include:

- App members.
- App roles.
- Organization member management.
- Role matrices.
- Member invitations.
- Access requests.
- Enterprise domain discovery.
- SAML, SCIM, or enterprise SSO.
- Ownership transfer.
- Asset takeover.
- Org-wide resource catalogs.
- Cross-account resource views.
- Agent external-access management.
- Files Library cross-account sharing or external-access management.
- Skill external-access management.
- Org-level MCP governance.
- Company credential pools.
- Per-member BYOK.
- Cross-member cost reporting.
- Audit logs.
- `app.type` as runtime, access, or ownership driver.
- A required single Agent type picker as the App creation path.
- Persistence-layer limits driven by App type or Agent type.
- Generic `services` table, polymorphic `service.kind`, or generic Service CRUD.
- Multi-resource graphs as the default burden for simple Apps.
- Generic Interface entity.
- App runtime.
- App router runtime.
- App-level API endpoint.
- Supabase-style App database tables.
- Multi-channel delivery as the main path.
- App-level multi-Agent Threads.

## Required Behaviors

### Onboarding

1. User signs in.
2. If the Account has no Organization, create one Organization shell.
3. If the Organization has no App, create one default App.
4. If the Organization has exactly one App, route directly to that App.
5. Do not show join organization, invite acceptance, request access, or domain discovery in
   the V1 path.

### Create App

1. User chooses New App.
2. System creates an App.
3. Console displays it as an App.
4. The App exposes scoped surfaces for Agents, Files, Environments, Skills, MCP
   servers, Provider credentials, Channels, and operations; it does not
   fabricate one instance of every resource.
5. App creation alone does not create a Vibe App, create Agent runtime, create an App-level API
   endpoint, or create application database tables.

### Configure App Resources

1. User creates or edits a concrete resource inside an App.
2. The resource type determines which configuration is relevant.
3. Agents choose runtime kind, model/provider, prompt/config, Environment, and
   optional resource bindings.
4. System validates required Provider credentials and Environment readiness for Agents.
5. Non-runtime resources do not gain runtime because they are listed beside Agents.

### Run Thread

1. User starts a Thread for one Agent.
2. System creates a Session for that Agent.
3. Session inherits App through the Agent.
4. Runtime freezes Environment revision, Provider/model references, Skill
   bindings, MCP bindings, and Channel metadata when applicable.
5. Each user turn materializes only ready attachment ids explicitly submitted
   with that message. Other Thread files remain linked and readable through the
   file surfaces but are not automatically injected into every turn. Thread
   files are not an Agent DeploymentVersion binding.
6. Runtime events stream back to the Thread.
7. App aggregates the Thread in App-level history and operations views.

### Expose Agent API

1. User exposes one Agent through an API endpoint.
2. System validates Agent readiness, required credentials, Environment readiness, and endpoint
   access settings.
3. External API calls create or continue Threads/Sessions for that Agent.
4. Usage and operations roll up to the App.

### Deliver Agent Through Channel

1. User configures a Channel at App scope.
2. User binds one Agent to that Channel.
3. External channel thread IDs map to Agent Sessions.
4. Channel delivery creates or continues Threads/Sessions for that Agent.
5. Usage and operations roll up to the App.

### Build And Publish Vibe App

1. User submits a natural-language prompt from App Overview.
2. `createAppVibeApp` creates one VibeSDK app bound to the App and generation starts
   immediately on the VibeSDK instance.
3. App Overview polls live status: generation phase, sandbox preview URL, and production URL.
   The user iterates with follow-up prompts and can refresh a stale preview.
4. `publishAppVibeApp` deploys the built app to Mosoo-managed Workers for Platforms; the
   production URL appears on App Overview when live. The user can mint a short-lived git clone
   URL to export the source, and delete removes the VibeSDK app plus the binding.
5. The Vibe App remains separate from Agent runtime, Agent Deployment Versions, and Agent API
   Endpoint exposure.

### App Operations

1. Runtime emits normalized model usage.
2. Cost service writes usage events with App as the primary business dimension.
3. Organization is retained as a billing rollup.
4. App Settings shows spend, request count, token/cache usage, daily spend, Agent attribution,
   and model/pricing breakdown. Recent usage rows are available in each Agent's Cost tab.
5. Agent detail owns Agent logs and runtime operations; App Overview owns Vibe App activity.
6. V1 does not show per-user drilldown.

### App Overview API

The App Overview API is the shared upstream surface for Web UI and generated CLI control-plane
summaries. It must not be a CLI-only facade. `appOverview` serves one App's console overview;
`controlPlaneOverview` serves current-user list flows such as generated CLI `ls` by returning
limited Apps with nested App overview summaries.

Rules:

- App-scoped overview requires App owner proof; current-user control-plane overview resolves the
  viewer's active Organization and applies the same App owner checks to each returned App.
- The first cut returns App identity, a limited Agent summary page, and a limited Provider
  credential metadata summary.
- Agent summary fields include stable runtime selection fields (`runtimeId`, `provider`, `model`)
  plus status and update time.
- Provider credential overview returns metadata and counts only. It does not expose plaintext
  secrets, masked keys, or custom endpoint URLs.
- Limit arguments are bounded so generated clients can use one stable selection set without
  accidentally expanding into an unbounded dashboard export.
- Future Overview expansion should add explicit subobjects for usage, health, logs, exposure, and
  resources rather than introducing a generic Service entity.

### Agent Run Workflow API

The Agent Run Workflow API is the shared upstream surface for Web UI and generated CLI run flows.
It must not be implemented as a CLI-only facade over lower-level Thread commands. `startAgentRun`
starts the shortest first-party workflow: create a Thread when needed, append one user prompt, and
queue the resulting Run.

GraphQL contract:

```graphql
mutation StartAgentRun($input: StartAgentRunInput!) {
  startAgentRun(input: $input) {
    acceptedAt
    createdSession
    session {
      id
      appId
      agentId
      status
      title
      lastRun {
        id
        status
        trigger
      }
    }
    run {
      id
      status
      trigger
    }
    eventSurface {
      appId
      sessionId
      graphqlUrl
      retrieveOperation
      processEventsOperation
      messagesOperation
      streamUrl
      suggestedPollIntervalMs
    }
    eventBatch {
      acceptedAt
      events {
        type
        clientRequestId
        run {
          id
          status
        }
      }
      warnings {
        code
        message
      }
    }
  }
}
```

Input rules:

- `appId` and `prompt` are required.
- `agentId` is required when `sessionId` is omitted. This creates a new Thread with session type
  `ui` by default, then queues a user-message Run.
- `sessionId` continues an existing Thread. If `agentId` is also supplied, it must match the
  Thread's bound Agent before any Run is queued.
- `clientRequestId` is passed to the queued user-message event for generated client correlation.
- `type` and `waitForRuntimeReady` intentionally mirror `createAgentSession`; readiness wait remains
  limited by the existing Session creation rules.

Rules:

- The mutation reuses existing GraphQL authenticated Session services for App ownership, participant
  access, action capabilities, audit attribution, runtime queueing, warnings, and GraphQL error
  envelopes.
- The response returns the canonical `Session`, `SessionRun`, and `AgentSessionEventBatch` shapes
  instead of a private CLI DTO.
- `eventSurface` gives generated clients stable identifiers and operation names for follow-up reads:
  `threadAgentSessionRetrieve`, `threadSessionProcessEvents`, and `threadSessionMessages`.
- `streamUrl` is nullable in V1 because the only current stream URL is the Personal Access Token
  Public Thread API. First-party streaming can be added later by filling this field without changing
  the mutation input.
- The mutation returns after the Run is queued. It does not hold the GraphQL request open for model
  output; generated clients should poll `threadSessionProcessEvents` using the returned `appId` and
  `sessionId` unless a first-party stream URL is later provided.

## Access Rules

- The Organization owner can access all Apps in that Organization.
- The App owner is the Organization owner in V1.
- Access checks are App owner checks.
- Legacy tenant/account rows must not be used to infer product-resource access.
- Code must not add admin/member branches for V1 behavior.

## Console IA

V1 console shape:

```text
Apps
+-- App
    +-- Overview
    |   +-- Vibe App build / preview / publish
    +-- Runs (/threads)
    +-- Agents
    +-- Config
    |   +-- Skills
    |   +-- MCP
    |   +-- Providers
    |   +-- Environments
    +-- Settings
        +-- General
        +-- App usage
```

Rules:

- A one-App Organization routes directly to App Overview.
- Apps list exists for creating or switching Apps, not as a blocking first screen.
- Members does not appear in V1 navigation.
- Organization settings stay thin.
- Agents is where users inspect App-local runtime/delivery units.
- Config groups Skills, MCP servers, Providers, and Environments.
- Channel configuration remains on the Agent surface rather than a top-level navigation item.
- App Overview owns the Vibe App build, preview, publish, and delete experience.
- App usage lives under App Settings; Agent logs live on Agent detail.
- Agent detail is where runtime, endpoint exposure, channel delivery, and Thread creation
  happen.
- The current sidebar label is Runs while the route and underlying product records remain
  `/threads` and Thread / Session.

## Migration Rules

- When older docs say Organization-owned resource, read it as App-owned unless it is
  explicitly about billing or future governance.
- When older docs say Workspace or Team, do not introduce those nouns.
- When older docs say Agent Service, read it as the existing Agent identity, not as a second
  Agent table or a separate App boundary.
- When older docs introduce a generic App-local Service capability/resource entity, treat that
  as historical wording. New work should model concrete resources directly.
- When older docs say Publish App, App API, Web shell, public preview URL, or the GitHub-backed
  Deployment, distinguish the shipped Vibe App resource from Agent runtime and App-level API
  semantics. Use [`app-vibe-app.md`](./prd/app-vibe-app.md) for Vibe App behavior.
- When older docs say App owns delivery surface, read it as App aggregates Agent exposure and
  operations; Agent owns endpoint and channel delivery in V1.
- When older docs ask users to choose one Agent type as the App creation path, treat the choice
  as an Agent setting rather than an App type.
- When older docs mention cross-account collaboration, org-wide resource catalogs,
  member role matrices, invitations, or access requests, treat it as future governance.
- Old governance tables should be deleted once runtime dependencies no longer need them;
  new App paths must fail closed instead of deriving access from historical records.

## Implemented Baseline

1. App ID, contracts, database tables, GraphQL surface, and default provisioning are in place.
2. Agents and concrete resources use App ownership and fail closed when App proof is missing.
3. Thread remains the product record backed by an Agent Session and inherits App through Agent.
4. Environment, Provider credentials, MCP servers, Skills, Files, and Channels are App-scoped.
5. Agent API Endpoint exposure and Channel delivery remain Agent-owned.
6. App Overview is the console root and embeds the Vibe App build/preview/publish/delete
   experience.
7. App usage is available under App Settings; Agent operational detail remains on Agent pages.
8. Public Members, role matrices, invitations, access requests, and old governance surfaces are
   absent from the V1 path.

## Acceptance Checklist

An implementation is aligned with this Spec when:

- A new user reaches a default App without seeing team or member flows.
- App Overview is the first screen for a one-App Organization.
- Creating an Agent requires an App context.
- Creating concrete resources requires an App context.
- There is no generic `services` table, `service.kind`, or generic Service CRUD.
- App creation alone does not create a Vibe App, create Agent runtime, create an App-level API
  endpoint, or create application database tables.
- Thread creation targets one Agent and creates a Session.
- App aggregates Threads from its Agents.
- Session Run is the execution record inside a Session.
- Provider credentials and default Environment resolve through App.
- Skills, MCP servers, and Channels are App-owned resources that Agents bind.
  Thread files follow Session scope; the reserved App library scope is not yet a
  shipped user-managed write surface.
- Agent exposure owns API endpoint and channel delivery.
- The Vibe App produces an external Web artifact and Mosoo-owned URL without becoming Agent
  runtime or an App-level API endpoint.
- App Overview exposes current Vibe App state and actions; App usage and Agent logs remain on
  their implemented settings/detail surfaces.
- Organization remains present only as tenant, billing rollup, and future governance shell.
- No new V1 code introduces App members, role matrices, invitations, or access requests.
