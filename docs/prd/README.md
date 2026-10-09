# Product Notes

One note per area, stating what users can rely on and where it stops. Product promises and non-goals live in [SPEC](../SPEC.md), cross-cutting invariants in [architecture](../architecture.md), and the general doc rules in [CONTRIBUTING](../../CONTRIBUTING.md#documentation).

A note has a purpose line, **Promises** and **Limits**, written in product language and kept under about 70 lines. Request shapes, schemas and mechanics stay in the OpenAPI documents, the GraphQL schema and code. When a note and the code disagree, find out which is wrong and fix it in the same change. A product question for the owner offers at least two user-visible options; decide engineering-only questions yourself.

## Sessions and API

- [Public Thread API](./public-thread-api-surface.md): v1 and v2, identity, events, idempotency, compatibility.
- [Thread lifecycle](./session-lifecycle.md): stop, archive, delete, Session maintenance, Preview expiry.
- [Thread files](./session-files.md): attachments, artifacts, deletion.
- [Runs and Logs](./default-consumption-surface.md): the console inbox and an Agent's Logs replay.

## Configuration and resources

- [Runtime choice](./runtime-catalog.md): runtimes, providers, model protocols.
- [Credentials](./credentials.md): provider keys and secret handling.
- [MCP connections](./mcp-interaction.md): remote servers and the delegation token.
- [Skills](./skill-interaction.md)
- [Environment](./environment.md): packages, variables, network policy.
- [Project usage](./cost-dashboard.md): estimates, not invoices.

## Working with product

- [Good PRD](../good-prd.md): how to write a feature PRD in its issue; notes here follow the format above.
- [For-human PRD](../for-human-prd.md): a plain-language companion for a feature PRD, kept with that PRD.
- [PM reverse interview](../pm-reverse-interview.md): bring an implementation question back to a product decision.
