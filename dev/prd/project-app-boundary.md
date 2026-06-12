# Project / App Boundary

Status: active construction lock.

This document is the source of truth for the current Project/App pivot. It supersedes older Agent-first, Workspace, team-member, org-library, and enterprise-governance language when deciding the next implementation sequence.

## Summary

The near-term Mosoo wedge is no longer an Agent-first console. The product loop is:

1. A personal developer brings `PRD.md`.
2. They invoke `@mosoo`.
3. Mosoo creates or selects a Project, shown as an App in console copy.
4. Mosoo provisions Agent services and app-local resources.
5. Mosoo deploys the Web shell and returns a public preview URL.

The current phase deliberately assumes one human owns one Organization. Organization remains the account, billing, tenant, and future governance shell. Project/App is the business, resource, and delivery boundary.

## Naming Lock

- **Project** is the canonical engineering noun for code, database schema, API contracts, architecture, tests, and migrations.
- **App** is the user-facing console noun. Users should feel they are operating an App, not a database entity.
- Do not introduce parallel nouns such as Workspace, Team, Application, Agent Service, Service App, or Product unless a later PRD explicitly reopens the naming decision.
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

- Agents and their published service surfaces.
- Threads / Sessions and session-facing public APIs.
- Spaces and Space mount intent.
- Environments and Environment revisions.
- Skills and app-local Skill bindings.
- MCP servers, MCP bindings, and MCP credentials.
- Provider keys / credentials used by the App.
- Deployment state, app health, and public preview URL.
- App-scoped usage and cost, with Organization rollups preserved for billing and future admin views.

Organization remains responsible for account identity, ownership, billing aggregation, and future governance. It must not be used as the default bucket for business resources in new Project/App work.

## Console IA

The console has two layers:

- **Organization layer**: Apps, Usage / Billing rollups, and thin Organization settings.
- **App layer**: Overview, Threads, Agents, Spaces, Environments, Skills, MCP servers, Providers, and App settings.

Onboarding should create a default App. If an Organization has exactly one App, login should route directly to that App. The Apps list exists for creating or switching between multiple Apps and should not block the one-App OPC path.

## Construction Order

1. Add the Project data model, shared contracts, GraphQL surface, and default Project creation during onboarding / Organization provisioning.
2. Move Agent creation and Agent reads under Project. Threads / Sessions should inherit Project from Agent rather than introducing an independent picker.
3. Move Environment and Provider defaults to Project scope, with Organization fallback only as a migration bridge.
4. Move MCP, Skills, and Spaces under Project/App resource ownership. Preserve existing resource semantics, but change the owning boundary first.
5. Add Project-scoped usage / cost while preserving Organization rollups for billing and future governance.
6. Reframe publish, distribution, Channels, API, and detail surfaces from Agent-first to App-first, where the App owns one or more Agent service surfaces.
7. Make the console root an App Overview. Keep the single-App direct-entry behavior before expanding multi-App management.
8. Only after the above is real, reopen Project members, org-wide asset libraries, role matrices, ownership transfer, and enterprise governance.

## Out Of Scope For This Phase

- Project members, Project roles, and Project invitation flows.
- Organization Library, pin / link semantics, and cross-project shared asset catalogs.
- Multi-user ownership transfer or asset takeover.
- Enterprise domain discovery expansion, SAML / SCIM, or rich member lifecycle administration.
- Reworking Agent Builder as the primary experience before Project ownership and default App creation exist.

## Drift Rules

- If a PRD says Organization-owned for a business resource listed above, read it as historical unless it explicitly says it is describing a future governance layer.
- If a PRD says member, coworker, shared with me, everyone in organization, Owner / Admin / Member, or access request, treat that text as future multi-member governance unless the current implementation already depends on it.
- If a PRD says Agent is the stable service identity, read it as the App owning the delivery surface and the Agent acting as an App-local service/runtime unit.
- If implementation work needs a new noun or access boundary, update this document, README, architecture, and the PRD index before changing code.
