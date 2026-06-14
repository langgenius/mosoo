# PRD Docs

Product contracts and the standards used to write them.

## Architecture

- [Architecture](../architecture.md): stable engineering boundaries and system-level contracts.

## Current direction

- [Mosoo Spec](../SPEC.md): canonical V1 nouns, relationships, non-goals, behavior, and implementation order.
- [Project / App Boundary](./project-app-boundary.md): active construction lock for the current pivot. Read this before implementing data model, IA, Agent ownership, resource ownership, access, or deployment changes.

## PRDs

Implementation contracts and shipped product behavior. Each PRD is the high-readability product specification for a capability. When older PRDs mention Organization-owned business assets, members, Admin reach-through, Workspace, Agent-first service identity, or a required single Agent type picker, apply the Project/App Boundary drift rules first.

### Agents & packaging

- [Agent Type (Pet vs Cattle)](./agent-type.md)
- [Agent Manifest](./agent-manifest.md)
- [Agent Import / Export & Fork](./agent-package-import-export-fork.md)
- [Agent Versions](./agent-versions.md)
- [Agent Service Identity & Deployment](./agent-service-identity.md)

### Runtime & sessions

- [Runtime Session Kernel](./runtime-session-kernel.md)
- [Agent Session API](./agent-session-api.md)
- [Runtime State Operations](./runtime-state-operations.md)
- [Session Lifecycle](./session-lifecycle.md)
- [Session Files](./session-files.md)
- [Session Log](./session-log.md)
- [Agent Runtime Logs](./agent-runtime-logs.md) — **deprecated** (Debug → System Log surface removed; dropped from the roadmap)
- [Agent Terminal](./agent-terminal.md)
- [Agent File Browser](./agent-file-browser.md) — **deprecated** (File Browser surface removed; dropped from the roadmap)

### Surfaces & channels

- [Default Consumption Surface (Threads)](./default-consumption-surface.md)
- [Channels](./channels.md)
- [Published Agent API Surface](./published-agent-api-surface.md)
- [Public Thread API](./public-task-api.md)
- [MCP (Connector)](./mcp-interaction.md)
- [Skill](./skill-interaction.md)
- [Space](./space-interaction.md)

### Historical / future access, identity & governance

- [Identity & Access](./identity-access.md) — future multi-member governance language must be read through the current single-owner Organization assumption.
- [RBAC](./rbac.md) — historical / future governance foundation; not a dependency for the current Project/App cut.
- [Credentials](./credentials.md) — current Project/App work moves Provider credentials to Project scope first, preserving Organization fallback only as migration context.

### Admin & cost

- [Cost Dashboard](./cost-dashboard.md)
- [Environment](./environment.md)

## Writing standards

- [PRD writing standard](./good-prd.md): how product contracts should be written and reviewed.
- [For-human PRD companion](./for-human-prd.md): how to mirror a full PRD into a high-readability, non-engineer version.
- [PM reverse interview](./pm-reverse-interview.md): product decision quality checklist.
