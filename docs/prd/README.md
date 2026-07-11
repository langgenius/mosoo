# PRD Docs

Product contracts and the standards used to write them.

## Architecture

- [Architecture](../architecture.md): stable engineering boundaries and system-level contracts.

## Current direction

- [Mosoo Spec](../SPEC.md): canonical V1 nouns, relationships, non-goals, behavior, and implemented baseline.
- [App Boundary](./app-boundary.md): active shipped ownership and IA boundary. Read this before changing data model, IA, Agent ownership, resource ownership, access, or deployment behavior.

## PRDs

This directory contains active contracts, shipped behavior, semantic companions, deferred work,
and superseded link stubs. Presence in this index does not mean a capability is shipped. Each
document must state its own status near the top; if it does not, verify it against the current
implementation before treating it as authoritative. When older PRDs mention Organization-owned
business assets, Workspace, or Agent-first service identity, apply the App Boundary drift rules
first.

### Agents & packaging

- [Agent Type (Pet vs Cattle)](./agent-type.md)
- [Agent Manifest](./agent-manifest.md) — active field contract; native-config drift/adopt UX is explicitly not shipped.
- [Agent Endpoint MVP](./agent-endpoint-mvp.md)
- [Agent Import / Export & Fork](./agent-package-import-export-fork.md)
- [Agent Versions](./agent-versions.md) — deferred.
- [Agent Exposure Identity & Deployment Version](./agent-service-identity.md)

### Runtime & sessions

- [Runtime Catalog Extension](./runtime-catalog.md) — implementation guide.
- [Runtime Session Kernel](./runtime-session-kernel.md) — semantic overview; Architecture/code own exact topology.
- [Agent Session API](./agent-session-api.md)
- [Runtime State Operations](./runtime-state-operations.md)
- [Session Lifecycle](./session-lifecycle.md) — implemented core lifecycle contract plus explicitly disclosed gaps.
- [Session Files](./session-files.md) — semantic companion for Thread files; OpenAPI owns the HTTP schema.
- [Session Log](./session-log.md)
- [Agent Terminal](./agent-terminal.md)

### Surfaces & channels

- [Default Consumption Surface (Threads)](./default-consumption-surface.md) — active shipped Runs/Thread UX.
- [Channels](./channels.md) — partial implementation; no top-level App Channels console.
- [App Vibe App](./app-vibe-app.md) — active App-owned web app built, previewed, and published through the platform's VibeSDK backend, embedded in App Overview and scoped separately from Agent versions and App runtime.
- [Public Thread API Surface](./public-thread-api-surface.md) — canonical product contract; checked-in OpenAPI owns the exact HTTP schema.
- [Public Thread API legacy link](./public-task-api.md) — superseded link stub.
- [MCP (Connector)](./mcp-interaction.md)
- [Skill](./skill-interaction.md)
- [Files API Contract](./files-api-contract.md) — internal Files ownership/service contract, not the Public Thread HTTP schema.
- [Credentials](./credentials.md) — Provider and MCP secrets owned by the active App; runtime resolves them from that same App boundary.

Surface boundary: public HTTPS exposure is an Agent API Endpoint inside one App. Thread is the public conversation object, Session is the runtime record, and Thread files are scoped to the admitted Thread/backing Session. Organization remains account and billing context, not a public API authorization boundary.

### Admin & cost

- [Cost Dashboard](./cost-dashboard.md)
- [Environment](./environment.md)

## Writing standards

- [PRD writing standard](../good-prd.md): how product contracts should be written and reviewed.
- [For-human PRD companion](../for-human-prd.md): how to mirror a full PRD into a high-readability, non-engineer version.
- [PM reverse interview](../pm-reverse-interview.md): product decision quality checklist.
