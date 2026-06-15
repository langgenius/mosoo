# Project / App Boundary

Status: active construction lock.

This document is the source of truth for the current Project/App pivot. It supersedes older Agent-first, Workspace, team-member, org-wide sharing, and enterprise-governance language when deciding the next implementation sequence.

## Summary

The near-term Mosoo wedge is no longer an Agent-first console. The product loop is:

1. A personal developer brings `PRD.md`.
2. They invoke `@mosoo`.
3. Mosoo creates or selects a Project, shown as an App in console copy.
4. Mosoo provisions App-local Agents and concrete resources.
5. Mosoo exposes an Agent through API or channel when needed.
6. Mosoo can export the App as one `Skill.md` for coding-agent reuse.

The current phase deliberately assumes one human owns one Organization. Organization remains the account, billing, tenant, and future governance shell. Project/App is the business, resource, operations, and export boundary. Runtime and delivery remain Agent responsibilities.

## Naming Lock

- **Project** is the canonical engineering noun for code, database schema, API contracts, architecture, tests, and migrations.
- **App** is the user-facing console noun. Users should feel they are operating an App, not a database entity.
- **Agent** is the App-local runtime and delivery unit backed by the existing Agent identity.
  Do not introduce a second Agent Service table, App boundary, or deployment topology.
- **Resources** are concrete App-owned nouns such as Channels, Spaces, Environments, Skills,
  MCP servers, Provider credentials, and future explicit runtime or database resources.
- **Service** is not a V1 domain entity. Do not add a unified `services` table,
  polymorphic `service.kind`, or generic Service CRUD for App resources.
- Do not introduce parallel boundary nouns such as Workspace, Team, Application, Service App,
  or Product unless a later PRD explicitly reopens the naming decision.
- Existing Agent-first routes and docs are migration context, not the desired final IA.

## Ownership Model

For this phase:

- One Organization has one human owner.
- A Project belongs to an Organization.
- A Project has an owner account, which is the Organization owner during the single-owner phase.
- There is no Project member table, Project role matrix, member invitation flow, ownership transfer, or cross-member access request in scope.
- Access checks may map Project access to the single Organization owner. Multi-member access should remain an extension point, not a dependency of the first cut.

## Resource Boundary

The following resources should belong to Project/App before they belong to a broad Organization surface:

- Agents and their API or channel exposure.
- Threads / Sessions, where Thread is the product name for an Agent Session in V1.
- Spaces and Space mount intent.
- Environments and Environment revisions.
- Skills and app-local Skill bindings.
- MCP servers, MCP bindings, and MCP credentials.
- Channels and Agent channel bindings.
- Provider keys / credentials used by the App.
- Agent exposure state, app health, logs, and App export.
- App-scoped usage and cost, with Organization rollups preserved for billing and future admin views.

Project/App does not own a V1 Web shell, App runtime, App-level API endpoint, or public preview URL. In V1, Agents own Agent runtime, API endpoint exposure, channel delivery, and Threads / Sessions. If a future Web/API runtime, database service, worker process, or scheduled job is needed, it should be modeled with an explicit noun and lifecycle rather than through a generic Service table.

Project Templates can provision repeatable resource graphs, such as one Pet Agent bound to one Channel. Templates are how simple chatbot-style Apps avoid a required App type or Agent type decision while still getting a complete starting shape.

Organization remains responsible for account identity, ownership, billing aggregation, and future governance. It must not be used as the default bucket for business resources in new Project/App work.

## Console IA

The console has two layers:

- **Organization layer**: Apps, Usage / Billing rollups, and thin Organization settings.
- **App layer**: Overview, Agents, Resources, Threads, Usage, Logs, Export, and App settings.
  The Resources view groups Channels / Gateways, Spaces, Environments, Skills, MCP servers,
  and Providers.

Onboarding should create a default App. If an Organization has exactly one App, login should route directly to that App. The Apps list exists for creating or switching between multiple Apps and should not block the one-App OPC path.

## Construction Order

1. Add the Project data model, shared contracts, GraphQL surface, and default Project creation during onboarding / Organization provisioning.
2. Move Agent creation and Agent reads under Project without introducing a generic Service entity. Threads / Sessions should inherit Project from Agent rather than introducing an independent picker.
3. Move concrete resources under Project/App ownership directly; do not route them through a unified `services` table.
4. Move Environment and Provider defaults to Project scope, with Organization fallback only as a migration bridge.
5. Move MCP, Skills, Spaces, and Channels under Project/App resource ownership. Preserve existing resource semantics, but change the owning boundary first.
6. Add Project Templates for common simple shapes such as Pet Agent plus Channel.
7. Add Project-scoped usage / cost while preserving Organization rollups for billing and future governance.
8. Keep API endpoint exposure on Agent. Do not add Publish App, App runtime, or App-level API endpoint.
9. Make the console root an App Overview. Keep the single-App direct-entry behavior before expanding multi-App management.
10. Add App export to one `Skill.md`.
11. Only after the above is real, reopen Project members, org-wide shared resources, role matrices, ownership transfer, and enterprise governance.

## Out Of Scope For This Phase

- Project members, Project roles, and Project invitation flows.
- Org-wide shared resources, pin / link semantics, and cross-project shared asset catalogs.
- Multi-user ownership transfer or asset takeover.
- Enterprise domain discovery expansion, SAML / SCIM, or rich member lifecycle administration.
- Publish App, App runtime, App-level API endpoint, Web shell, or public preview URL as V1 commitments.
- App type / Project type, a required single Agent type picker as the App creation path,
  persistence-layer limits driven by App type or Agent type, or generic Interface entity.
- Generic `services` table, polymorphic `service.kind`, or generic Service CRUD for concrete
  App resources.
- Multi-resource graphs as the default burden for simple Apps.
- Reworking Agent Builder as the primary experience before Project ownership and default App creation exist.

## Drift Rules

- If a PRD says Organization-owned for a business resource listed above, read it as historical unless it explicitly says it is describing a future governance layer.
- If a PRD says member, coworker, shared with me, everyone in organization, Owner / Admin / Member, or access request, treat that text as future multi-member governance unless the current implementation already depends on it.
- If a PRD says Agent Service, read it as the existing Agent identity, not as a second Agent
  table or a separate App boundary.
- If a PRD says Service is the App-local capability/resource unit, treat that as historical
  wording; new work should model concrete resources directly.
- If a PRD says Agent is the stable service identity, read it as Agent owning runtime and exposure while App aggregates Agent operations.
- If a PRD asks users to choose one Agent type as the creation path, prefer a Project Template or an Agent setting, depending on whether the choice describes an App shape or a runtime behavior.
- If a PRD says Publish App, App API, Web shell, or public preview URL, treat it as old Web-app-first wording unless a later spec reopens the decision.
- If implementation work needs a new noun or access boundary, update this document, README, architecture, and the PRD index before changing code.
