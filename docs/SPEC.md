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
3. App is an Agent capability package, not a Web deployment unit.
4. Organization is only the account, billing, tenant, and future-governance shell.
5. App has no runtime. Runtime belongs to Agents.
6. Agent is the App-local execution and delivery unit.
7. Thread is the product name for an Agent Session in V1.
8. App resources are shared at App scope; Agents bind the resources they need.
9. V1 optimizes for delivery and reuse, not administration.
10. Owner-only access is the default for V1.
11. Future governance must not block the single-owner App loop.

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

- Is what the user creates, opens, configures, monitors, and exports.
- Is a boundary for a real-world Agent application.
- Belongs to one Organization.
- Has one owner Account in V1.
- Organizes one or more Agents.
- Owns shared resources used by those Agents.
- Is the primary database, API, and test boundary.
- Aggregates Threads, usage, health, logs, and expose state through its Agents.
- Can be packaged into one `Skill.md` for coding-agent reuse.
- Is the default console entry after onboarding when the Organization has one App.

An App is not a Supabase-style database app, a Vercel-style frontend deployment, a
GitHub repository, a Web shell, or a runtime process.

### Agent

An Agent is an App-local execution and delivery unit.

An Agent:

- Belongs to one App.
- Has a runtime kind such as Pet or Cattle.
- References one Environment.
- May bind App-owned Storage, Skills, MCP servers, Provider credentials, and Channels.
- Owns runtime execution.
- Owns API endpoint exposure when exposed.
- Owns channel delivery when bound to a Channel.
- Owns Threads/Sessions in V1.

"Agent Service" is discussion language for this same entity. It is not a separate V1
entity, table, service layer, or product container.

An App can contain many Agents, but one Agent per App is expected to be common.

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

Organization default environments and admin compliance overrides are migration or future
governance concepts.

### Storage / Space

Storage is persistent App-local file storage. Existing code may still use the name Space.

Storage:

- Belongs to one App.
- Stores user-visible files and directories.
- Can be mounted into Agent execution.
- Can receive write summaries from runtime file activity.
- Can be bound by one or more Agents.

Storage collaborator views and org-wide storage catalogs are future governance concepts.

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
- Can be bound by one or more Agents.
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

There is no V1 Publish App action.

### App Export

App Export packages the whole App into one `Skill.md`.

The exported `Skill.md`:

- Describes the App's Agents and their responsibilities.
- Describes required App-owned resources and bindings.
- Describes Thread/API/channel usage patterns.
- Is meant for coding-agent reuse.

V1 exports the whole App, not one `Skill.md` per Agent.

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
        +-- Storage / Spaces
        +-- Environments
        +-- Skills
        +-- MCP Servers
        +-- Provider Credentials
        +-- Channels
        +-- Operations
        |   +-- usage
        |   +-- health
        |   +-- logs
        +-- Export
            +-- Skill.md
```

Rules:

- Organization owns Apps, not App resources directly.
- App owns organization, resource, export, and operations scope.
- App has no runtime.
- Agent owns runtime, endpoint exposure, channel delivery, and V1 Threads/Sessions.
- Thread is a product name for Agent Session in V1.
- Usage has App as the business dimension and Organization as the billing rollup.

## V1 Goals

V1 must support:

- A personal developer signs in.
- The system creates or selects the developer's Organization shell.
- The system creates a default App.
- The user can create or configure one or more Agents inside the App.
- The Agent can reference an Environment.
- The Agent can use App-local Provider credentials.
- The Agent can bind App-local Storage, Skills, MCP servers, and Channels when configured.
- The user can create Threads for an Agent from Mosoo WebUI.
- The user can expose an Agent through an API endpoint.
- The system can map channel external threads to Agent Sessions when Channel delivery is
  configured.
- The user can inspect App-scoped Threads, usage, health, logs, and Agent expose state.
- The user can export the App as one `Skill.md`.

## Non Goals

V1 must not include:

- App members.
- App roles.
- Organization member management.
- RBAC matrices.
- Member invitations.
- Access requests.
- Enterprise domain discovery.
- SAML, SCIM, or enterprise SSO.
- Ownership transfer.
- Asset takeover.
- Org-wide shared resource catalogs.
- Cross-account shared resource views.
- Org-wide resource catalogs.
- Agent collaborator management.
- Storage collaborator management.
- Skill sharing.
- Org-shared MCP governance.
- Company credential pools.
- Per-member BYOK.
- Cross-member cost reporting.
- Audit logs.
- `app.type` or `app.type` as runtime, access, or ownership drivers.
- Generic Interface entity.
- App runtime.
- App router runtime.
- Publish App.
- App-level API endpoint.
- App-owned Web shell.
- Public preview URL as an App commitment.
- Vercel-style frontend deployment.
- Supabase-style App database tables.
- GitHub repository binding as an App requirement.
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
2. System creates a App.
3. Console displays it as an App.
4. System creates or assigns default App-local resource sets for Agents, Storage,
   Environments, Skills, MCP servers, Provider credentials, Channels, operations, and export.
5. System does not create Web shell, GitHub repository, App runtime, App API endpoint, or
   database tables as a consequence of App creation.

### Configure Agent

1. User creates or edits an Agent inside an App.
2. Agent chooses runtime kind, model/provider, prompt/config, Environment, and optional
   resource bindings.
3. System validates required Provider credentials and Environment readiness.
4. Agent remains the runtime and delivery unit.

### Run Thread

1. User starts a Thread for one Agent.
2. System creates a Session for that Agent.
3. Session inherits App through the Agent.
4. Runtime freezes Environment revision, Provider references, Skill bindings, MCP bindings,
   Storage mounts, and Channel metadata when applicable.
5. Runtime events stream back to the Thread.
6. App aggregates the Thread in App-level history and operations views.

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

### Export App

1. User exports an App.
2. System generates one `Skill.md` for the whole App.
3. The `Skill.md` describes Agents, resources, bindings, and Thread/API/channel usage.
4. Runtime does not depend on the exported file.

### App Operations

1. Runtime emits normalized model usage.
2. Cost service writes usage events with App as the primary business dimension.
3. Organization is retained as a billing rollup.
4. App views show Agent list, Thread history, expose state, spend, request count,
   token/cache usage, model breakdown, recent runs, logs, health, and unpriced usage count.
5. V1 does not show member drilldown.

## Access Rules

- The Organization owner can access all Apps in that Organization.
- The App owner is the Organization owner in V1.
- New access checks should be App owner checks.
- Existing Organization membership checks are migration compatibility only.
- New code must not add admin/member branches for V1 behavior.

## Console IA

V1 console shape:

```text
Apps
+-- App
    +-- Overview
    +-- Agents
    +-- Threads
    +-- Storage
    +-- Environments
    +-- Skills
    +-- MCP
    +-- Providers
    +-- Channels
    +-- Usage
    +-- Logs
    +-- Export
    +-- Settings
```

Rules:

- A one-App Organization routes directly to App Overview.
- Apps list exists for creating or switching Apps, not as a blocking first screen.
- Members does not appear in V1 navigation.
- Organization settings stay thin.
- Agent detail is where runtime, endpoint exposure, channel delivery, and Thread creation
  happen.
- WebUI Thread views operate Mosoo Sessions; they are not a user-published Web App surface.

## Migration Rules

- When older docs say Organization-owned resource, read it as App-owned unless it is
  explicitly about billing or future governance.
- When older docs say Workspace or Team, do not introduce those nouns.
- When older docs say Agent Service, read it as Agent.
- When older docs say Publish App, App API, Web shell, or public preview URL, treat it as
  old Web-app-first wording unless a later spec reopens the decision.
- When older docs say App owns delivery surface, read it as App aggregates Agent exposure and
  operations; Agent owns endpoint and channel delivery in V1.
- When older docs mention cross-account collaboration, org-wide resource catalogs,
  member role matrices, invitations, or access requests, treat it as future governance.
- Do not delete compatibility tables until App ownership and owner access replace
  their runtime dependencies.

## Implementation Order

1. Add App ID, contract, database table, GraphQL surface, and default provisioning.
2. Add App owner access helpers and keep Organization membership only as a migration bridge.
3. Move Agent creation, reads, updates, and readiness under App.
4. Keep Thread as Agent Session in V1; add App inheritance through Agent and App-level
   aggregation.
5. Move Environment defaults and Provider credentials under App.
6. Move MCP servers, Skills, Storage/Spaces, and Channels under App resource ownership.
7. Keep Agent API endpoint exposure and Channel delivery on Agent.
8. Add App usage, health, logs, and Organization billing rollup.
9. Make App Overview the console root.
10. Add App export to one `Skill.md`.
11. Remove or hide public Members, RBAC, invitations, access requests, resource-sharing,
    App-publish, preview-URL, and Web-shell surfaces from the V1 path.
12. Remove internal services, contracts, tests, and database tables for old governance after
    no runtime path depends on them.

## Acceptance Checklist

An implementation is aligned with this Spec when:

- A new user reaches a default App without seeing team or member flows.
- App Overview is the first screen for a one-App Organization.
- Creating an Agent requires an App context.
- App creation does not create Web shell, GitHub repository, App runtime, App API endpoint, or
  database tables.
- Thread creation targets one Agent and creates a Session.
- App aggregates Threads from its Agents.
- Session Run is the execution record inside a Session.
- Provider credentials and default Environment resolve through App.
- Storage, Skills, MCP servers, and Channels are App-owned resources that Agents bind.
- Agent exposure owns API endpoint and channel delivery.
- There is no Publish App action in the V1 path.
- Export creates one `Skill.md` for the whole App.
- Usage, health, and logs are visible at App scope.
- Organization remains present only as tenant, billing rollup, and future governance shell.
- No new V1 code introduces App members, RBAC, invitations, or access requests.
