# App Boundary

Status: active construction lock.

This document is the source of truth for the current App pivot. It supersedes older Agent-first, Workspace, team-member, org-wide sharing, and enterprise-governance language when deciding the next implementation sequence.

## Summary

The near-term Mosoo wedge is no longer an Agent-first console. The product loop is:

1. A personal developer brings `PRD.md`.
2. They invoke `@mosoo`.
3. Mosoo creates or selects a App, shown as an App in console copy.
4. Mosoo provisions Agents and app-local resources.
5. Mosoo exposes an Agent through API or channel when needed.
6. Mosoo can export the App as one `Skill.md` for coding-agent reuse.

The current phase deliberately assumes one human owns one Organization. Organization remains the account, billing, tenant, and future governance shell. App is the business, resource, operations, and export boundary. Runtime and delivery remain Agent responsibilities.

## Naming Lock

- **App** is the canonical engineering noun for code, database schema, API contracts, architecture, tests, and migrations.
- **App** is the user-facing console noun. Users should feel they are operating an App, not a database entity.
- Do not introduce parallel nouns such as Workspace, Team, Application, Agent Service, Service App, or Product unless a later PRD explicitly reopens the naming decision. "Agent Service" is discussion language for Agent, not a new entity.
- Existing Agent-first routes and docs are migration context, not the desired final IA.

## Ownership Model

For this phase:

- One Organization has one human owner.
- A App belongs to an Organization.
- A App has an owner account, which is the Organization owner during the single-owner phase.
- There is no App member table, App role matrix, member invitation flow, ownership transfer, or cross-member access request in scope.
- Access checks may map App access to the single Organization owner. Multi-member access should remain an extension point, not a dependency of the first cut.

## Resource Boundary

The following resources should belong to App before they belong to a broad Organization surface:

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

App does not own a V1 Web shell, App runtime, App-level API endpoint, or public preview URL. Agent owns runtime, API endpoint exposure, and channel delivery.

Organization remains responsible for account identity, ownership, billing aggregation, and future governance. It must not be used as the default bucket for business resources in new App work.

## Console IA

The console has two layers:

- **Organization layer**: Apps, Usage / Billing rollups, and thin Organization settings.
- **App layer**: Overview, Threads, Agents, Spaces, Environments, Skills, MCP servers, Providers, Channels, Usage, Logs, Export, and App settings.

Onboarding should create a default App. If an Organization has exactly one App, login should route directly to that App. The Apps list exists for creating or switching between multiple Apps and should not block the one-App OPC path.

## Construction Order

1. Add the App data model, shared contracts, GraphQL surface, and default App creation during onboarding / Organization provisioning.
2. Move Agent creation and Agent reads under App. Threads / Sessions should inherit App from Agent rather than introducing an independent picker.
3. Move Environment and Provider defaults to App scope, with Organization fallback only as a migration bridge.
4. Move MCP, Skills, and Spaces under App resource ownership. Preserve existing resource semantics, but change the owning boundary first.
5. Add App-scoped usage / cost while preserving Organization rollups for billing and future governance.
6. Move Channels under App resource ownership while keeping Agent channel delivery on Agent.
7. Keep API endpoint exposure on Agent. Do not add Publish App, App runtime, or App-level API endpoint.
8. Make the console root an App Overview. Keep the single-App direct-entry behavior before expanding multi-App management.
9. Add App export to one `Skill.md`.
10. Only after the above is real, reopen App members, org-wide shared resources, role matrices, ownership transfer, and enterprise governance.

## Out Of Scope For This Phase

- App members, App roles, and App invitation flows.
- Org-wide shared resources, pin / link semantics, and cross-app shared asset catalogs.
- Multi-user ownership transfer or asset takeover.
- Enterprise domain discovery expansion, SAML / SCIM, or rich member lifecycle administration.
- Publish App, App runtime, App-level API endpoint, Web shell, or public preview URL as V1 commitments.
- App type / App type or generic Interface entity.
- Reworking Agent Builder as the primary experience before App ownership and default App creation exist.

## Drift Rules

- If a PRD says Organization-owned for a business resource listed above, read it as historical unless it explicitly says it is describing a future governance layer.
- If a PRD says member, coworker, shared with me, everyone in organization, Owner / Admin / Member, or access request, treat that text as future multi-member governance unless the current implementation already depends on it.
- If a PRD says Agent Service, read it as Agent.
- If a PRD says Agent is the stable service identity, read it as the Agent owning runtime and exposure while App aggregates Agent operations.
- If a PRD says Publish App, App API, Web shell, or public preview URL, treat it as old Web-app-first wording unless a later spec reopens the decision.
- If implementation work needs a new noun or access boundary, update this document, README, architecture, and the PRD index before changing code.
