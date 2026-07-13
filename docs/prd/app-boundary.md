# App Boundary

Status: historical baseline (shipped); superseded by [docs/SPEC.md](../SPEC.md) where they conflict.

This document recorded the App pivot as it shipped. It still decodes older Agent-first, Workspace, team-member, org-wide sharing, and enterprise-governance language, but the canonical product contract — including deployment source, Release, and execution model — is now [docs/SPEC.md](../SPEC.md); do not use this file to decide new implementation sequence.

## Summary

The near-term Mosoo wedge is no longer an Agent-first console. The product loop is:

1. A personal developer brings `PRD.md`.
2. They invoke `@mosoo`.
3. Mosoo creates or selects an App.
4. Mosoo provisions Agents and app-local resources.
5. Mosoo exposes an Agent through API or channel when needed.
6. From App Overview, Mosoo can deploy a public GitHub repository as an App-owned external Web
   artifact with a Mosoo-owned URL.

The current phase deliberately assumes one human owns one Organization. Organization remains the
account, billing, tenant, and future governance shell. App is the business, resource, operations,
and deployment boundary. Agent runtime and delivery remain Agent responsibilities.

## Naming Lock

- **App** is the canonical product and engineering noun for code, database schema,
  API contracts, architecture, tests, migrations, and console copy.
- **Agent** is the App-local runtime and delivery unit backed by the existing Agent identity.
  Do not introduce a second Agent Service table, App boundary, or deployment topology.
- **Resources** are concrete App-owned nouns such as Channels, Files, Environments, Skills,
  MCP servers, Provider credentials, and future explicit runtime or database resources.
- **Service** is not a V1 domain entity. Do not add a unified `services` table,
  polymorphic `service.kind`, or generic Service CRUD for App resources.
- Do not introduce parallel boundary nouns such as Workspace, Team, Application, Service App,
  Agent Service, or Product unless a later PRD explicitly reopens the naming decision.
- Existing Agent-first routes and docs are migration context, not the desired final IA.

## Ownership Model

For this phase:

- One Organization has one human owner.
- An App belongs to an Organization.
- An App has an owner account, which is the Organization owner during the single-owner phase.
- There is no App member table, App role matrix, member invitation flow, ownership transfer, or cross-member access request in scope.
- Access checks may map App access to the single Organization owner. Multi-member access should remain an extension point, not a dependency of the first cut.

## Resource Boundary

The following resources should belong to App before they belong to a broad Organization surface:

- Agents and their API or channel exposure.
- Threads / Sessions, where Thread is the product name for an Agent Session in V1.
- File records, including shipped Session attachments/artifacts and the
  reserved (not yet user-creatable) App library scope.
- Environments and Environment revisions.
- Skills and app-local Skill bindings.
- MCP servers, MCP bindings, and MCP credentials.
- Channels and Agent channel bindings.
- Provider keys / credentials used by the App.
- Agent exposure state, Agent logs, App Deployment, and Deployment Runs.
- App-scoped usage and cost, with Organization rollups preserved for billing and future admin views.

App may own one active Deployment sourced from a public GitHub repository. Deployment is a
separately modeled external Web artifact with Deployment Runs and a Mosoo-owned public URL; it is
not Agent runtime, an Agent Deployment Version, or an App-level API endpoint. Agents continue to
own Agent runtime, API endpoint exposure, channel delivery, and Threads / Sessions. Any future
database service, scheduled job, or worker runtime needs its own explicit noun and lifecycle rather
than a generic Service table.

Organization remains responsible for account identity, ownership, billing aggregation, and future governance. It must not be used as the default bucket for business resources in new App work.

## Console IA

The console has two layers:

- **Organization layer**: Apps and thin Organization settings. Usage/Billing entries are currently visible as `Soon`, not shipped rollup pages.
- **App layer**: Overview, Runs, Agents, Config, and Settings.
  - Overview embeds Deployment install, status, activity, live URL, retry/redeploy, and delete.
  - Runs uses the current `/threads` route and Thread / Session records.
  - Config groups Skills, MCP servers, Providers, and Environments.
  - Settings contains General and App usage.
  - Channel configuration and Agent logs remain on Agent detail rather than top-level navigation.

Onboarding should create a default App. If an Organization has exactly one App, login should route directly to that App. The Apps list exists for creating or switching between multiple Apps and should not block the one-App OPC path.

## Implemented Baseline

1. App data model, contracts, GraphQL surface, default provisioning, and owner checks are in place.
2. Agent, Thread / Session, Environment, Provider, MCP, Skill, File, and Channel paths are App-scoped.
3. Agent API Endpoint exposure and Channel delivery remain Agent-owned.
4. App Overview is the console root and embeds the current Deployment workflow.
5. App-scoped usage is under App Settings, while Agent logs and runtime operations remain on Agent
   detail.
6. App members, org-wide catalogs, role matrices, ownership transfer, and enterprise governance
   remain out of scope for the single-owner phase.

## Out Of Scope For This Phase

- App members, App roles, and App invitation flows.
- Org-wide resource catalogs, pin / link semantics, and cross-app asset catalogs.
- Multi-user ownership transfer or asset takeover.
- Enterprise domain discovery expansion, SAML / SCIM, or rich member lifecycle administration.
- Treating App Deployment as Agent runtime, a generic App runtime, or an App-level API endpoint.
- App type, a required single Agent type picker as the App creation path,
  persistence-layer limits driven by App type or Agent type, or generic Interface entity.
- Generic `services` table, polymorphic `service.kind`, or generic Service CRUD for concrete
  App resources.
- Multi-resource graphs as the default burden for simple Apps.
- Reviving the removed Agent Builder system-assistant as the primary experience before App ownership and default App creation exist.

## Drift Rules

- If a PRD says Organization-owned for a business resource listed above, read it as historical unless it explicitly says it is describing a future governance layer.
- If a PRD says member, coworker, everyone in organization, Owner / Admin / Member, or access request, treat that text as future multi-member governance unless the current implementation already depends on it.
- If a PRD describes cross-account collaboration, org-wide resource catalogs, member role matrices, or access-request flows, treat that text as future multi-member governance unless the current implementation already depends on it.
- If a PRD says Agent Service, read it as the existing Agent identity, not as a second Agent
  table or a separate App boundary.
- If a PRD says Service is the App-local capability/resource unit, treat that as historical
  wording; new work should model concrete resources directly.
- If a PRD says Agent is the stable service identity, read it as Agent owning runtime and exposure while App aggregates Agent operations.
- If a PRD asks users to choose one Agent type as the App creation path, treat the choice as an
  Agent setting rather than an App type.
- If a PRD says Publish App, App API, Web shell, or public preview URL, distinguish the shipped
  App Deployment resource from Agent runtime and App-level API semantics. Use
  [`app-deployment.md`](./app-deployment.md) for Deployment behavior.
- If implementation work needs a new noun or access boundary, update this document, README, architecture, and the PRD index before changing code.
