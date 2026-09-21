# Product Notes

These pages are short, code-checked product snapshots for non-engineers. Each
one explains why a capability exists, what people can do today, and its visible
limits. They are not implementation specifications.

Read [mosoo Spec](../SPEC.md) for the target product direction. When a product
note, the Spec, and current code disagree, do not guess: verify the behavior and
update the stale note. Exact APIs, data shapes, and runtime topology belong in
their machine-readable contracts, code, or [Architecture](../architecture.md).

## Runtime and API

- [Managed Agent v1 target and remaining slices](./managed-agent-v1.md) — shipped Project keys, BYOK direct invocation with optional Agent presets, with single-turn and multi-turn acceptance; platform supply and billing are separate.
- [Cloud migration and compatibility](../SPEC.md#10-migration-and-breaking-change-notification) — preserve compatible Thread APIs and verify the transition from shared machines to Session isolation.
- [Agent API Endpoint](./agent-endpoint-mvp.md)
- [Public Thread API](./public-thread-api-surface.md) — shipped v1 contract, current saved-Agent v2 entry point, and the unimplemented direct-invocation target.
- [Runtime Sessions](./runtime-session-kernel.md)
- [Runtime Choice](./runtime-catalog.md)
- [Runs and Threads](./default-consumption-surface.md)
- [Agent Work History](./agent-session-api.md)
- [Thread Lifecycle](./session-lifecycle.md) — formal continuation and the Cloud debug Preview 30-day inactivity policy.
- [Thread Continuation](./thread-continuation.md)
- [Runtime State Operations](./runtime-state-operations.md)
- [Agent Terminal](./agent-terminal.md)
- [Session Log](./session-log.md)

## Agent configuration

- [Project Boundary](./project-boundary.md)
- [Agent Type](./agent-type.md)
- [Agent Manifest](./agent-manifest.md)
- [Agent Publishing and Versions](./agent-service-identity.md)
- [Agent Version History](./agent-versions.md)
- [Agent Import, Export, and Fork](./agent-package-import-export-fork.md)

## Resources and operations

- [Thread Files](./session-files.md)
- [Skills](./skill-interaction.md)
- [MCP Connections](./mcp-interaction.md)
- [Credentials](./credentials.md)
- [Environment](./environment.md)
- [Project Usage](./cost-dashboard.md)

## Legacy aliases

- [Files API](./files-api-contract.md)
- [Public Task API](./public-task-api.md)
