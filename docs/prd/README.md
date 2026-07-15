# Product Notes

These pages are short, code-checked product snapshots for non-engineers. Each
one explains why a capability exists, what people can do today, and its visible
limits. They are not implementation specifications.

Read [Mosoo Spec](../SPEC.md) for the target product direction. When a product
note, the Spec, and current code disagree, do not guess: verify the behavior and
update the stale note. Exact APIs, data shapes, and runtime topology belong in
their machine-readable contracts, code, or [Architecture](../architecture.md).

## Apps and Agents

- [App Boundary](./app-boundary.md)
- [App Deployment](./app-deployment.md)
- [Agent Type](./agent-type.md)
- [Agent Manifest](./agent-manifest.md)
- [Agent Publishing and Versions](./agent-service-identity.md)
- [Agent Version History](./agent-versions.md)
- [Agent Import, Export, and Fork](./agent-package-import-export-fork.md)
- [Agent API Endpoint](./agent-endpoint-mvp.md)

## Work and runtime

- [Runs and Threads](./default-consumption-surface.md)
- [Agent Work History](./agent-session-api.md)
- [Thread Lifecycle](./session-lifecycle.md)
- [Runtime Sessions](./runtime-session-kernel.md)
- [Runtime Choice](./runtime-catalog.md)
- [Runtime State Operations](./runtime-state-operations.md)
- [Agent Terminal](./agent-terminal.md)
- [Session Log](./session-log.md)

## Delivery and resources

- [Public Thread API](./public-thread-api-surface.md)
- [Channels](./channels.md)
- [Thread Files](./session-files.md)
- [Files API legacy link](./files-api-contract.md)
- [Skills](./skill-interaction.md)
- [MCP Connections](./mcp-interaction.md)
- [Credentials](./credentials.md)
- [Environment](./environment.md)

## Operations

- [App Usage](./cost-dashboard.md)

## Removed names

- [Public Task API](./public-task-api.md)
