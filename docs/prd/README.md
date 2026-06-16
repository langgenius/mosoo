# PRD Docs

Product contracts and the standards used to write them.

## Architecture

- [Architecture](../architecture.md): stable engineering boundaries and system-level contracts.

## Current direction

- [Mosoo Spec](../SPEC.md): canonical V1 nouns, relationships, non-goals, behavior, and implementation order.
- [App Boundary](./app-boundary.md): active construction lock for the current pivot. Read this before implementing data model, IA, Agent ownership, resource ownership, access, or deployment changes.

## PRDs

Implementation contracts and shipped product behavior. Each PRD is the high-readability product specification for a capability. When older PRDs mention Organization-owned business assets, Workspace, or Agent-first service identity, apply the App Boundary drift rules first.

### Agents & packaging

- [Agent Type (Pet vs Cattle)](./agent-type.md)
- [Agent Manifest](./agent-manifest.md)
- [Agent Import / Export & Fork](./agent-package-import-export-fork.md)
- [Agent Versions](./agent-versions.md)
- [Agent Exposure Identity & Deployment Version](./agent-service-identity.md)

### Runtime & sessions

- [Runtime Session Kernel](./runtime-session-kernel.md)
- [Agent Session API](./agent-session-api.md)
- [Runtime State Operations](./runtime-state-operations.md)
- [Session Lifecycle](./session-lifecycle.md)
- [Session Files](./session-files.md)
- [Session Log](./session-log.md)
- [Agent Terminal](./agent-terminal.md)

### Surfaces & channels

- [Default Consumption Surface (Threads)](./default-consumption-surface.md)
- [Channels](./channels.md)
- [Public Thread API Surface](./public-thread-api-surface.md)
- [Public Thread API legacy link](./public-task-api.md) — old filename kept readable; use the surface PRD above as the canonical contract.
- [MCP (Connector)](./mcp-interaction.md)
- [Skill](./skill-interaction.md)
- [Space](./space-interaction.md)
- [Credentials](./credentials.md) — Provider and MCP secrets owned by the active App; runtime resolves them from that same App boundary.

Surface boundary: public HTTPS exposure is an Agent API Endpoint inside one App. Thread is the public conversation object, Session is the runtime record, and Thread files are scoped to the admitted Thread/backing Session. Organization remains account and billing context, not a public API authorization boundary.

### Admin & cost

- [Cost Dashboard](./cost-dashboard.md)
- [Environment](./environment.md)

## Writing standards

- [PRD writing standard](./good-prd.md): how product contracts should be written and reviewed.
- [For-human PRD companion](./for-human-prd.md): how to mirror a full PRD into a high-readability, non-engineer version.
- [PM reverse interview](./pm-reverse-interview.md): product decision quality checklist.
