# Public Thread API

The HTTP contract an application backend uses to run work on mosoo: start a Thread, follow its events, continue or stop it, and manage its files. Exact request and response shapes are in the generated OpenAPI documents ([v1](../../apps/api/openapi/public-api-v1.generated.json), [v2](../../apps/api/openapi/public-api-v2.generated.json)), also served at `/api/v1/openapi.json` and `/api/v2/openapi.json`.

## Promises

- A Thread is one durable Session, and its ID is the only handle a backend needs: read it, list or stream its events, send follow-ups, cancel the current turn, archive, unarchive or delete it, and manage its files. Continuation is promised in [SPEC](../SPEC.md) section 4; stop, archive and delete behave as in [Thread lifecycle](./session-lifecycle.md).
- **`/api/v2` is Project-direct.** `POST /api/v2/projects/{projectId}/threads` takes exactly one configuration source: `inline` (harness, provider, model, instructions), which creates no Agent, or `agent`, a saved preset resolved to its latest saved configuration whether or not it is published. Sources never merge. v2 also uploads files to a Project ahead of attaching them, and returns a Thread's per-call model usage.
- A v2 caller reaches every Thread its account owns in the Project, whichever channel created it.
- **`/api/v1` serves published Agents.** Creating a Thread and every later read need the Agent to be published with a live version, so unpublishing also cuts v1 access to existing Threads. New v1 Threads use the current live version, and no call selects an older one. Saving a published Agent with any change other than its name or description activates a new live version at once; the console's version history lists them newest first and is view-only.
- v1 requires `userId`, returns the legacy `kind` field, and lists and reads only Threads that v1 created with a `userId`. v2 omits `kind`.
- A Thread keeps the configuration it was created with. Later preset edits and publishes affect only new Threads.
- **Identity.** The backend may label a Thread with an opaque `userId` (required on v1, optional on v2, stored as `null` when omitted). It is fixed at creation, need not be unique per Thread, and reaches MCP servers as the delegated end user ([MCP connections](./mcp-interaction.md)). mosoo does not authenticate end users; the backend owns their login and authorization.
- **Keys.** Project API keys are backend secrets created in Project settings, each valid for exactly one Project ([SPEC](../SPEC.md) section 2). Rotating keys does not change Thread ownership: any key of the same Project continues the Thread.
- **Events.** Events are persisted before delivery, and the list endpoint and SSE read the same history. SSE first sends the latest persisted events, then each new one once it is persisted. Events report sanitized progress, not raw runtime data. Correlate the start, confirmation and result of one tool call by `toolCallId`, not by event `id`.
- **Files.** A Thread's files are its attachments plus the artifacts the Agent records, not the runtime workspace ([Thread files](./session-files.md)).
- **Usage.** `GET /api/v2/threads/{threadId}/usage` lists one record per model call. It reads the Session's own call records, which the usage rollup behind [Project usage](./cost-dashboard.md) never removes. Missing values stay `null`; the only cost it returns is a USD amount the runtime itself reported, which is not an invoice.
- **Retries.** Creation and follow-up accept an optional `Idempotency-Key`, scoped to the Project for Project keys and kept for 24 hours. The same key and body return the original result; a changed body conflicts; a repeat while the original is still processing returns `409`. Once a creation has stalled, a repeat reconciles it against what was committed; a stalled follow-up keeps returning `409` for the rest of the window rather than risk running twice. Save the returned Thread ID: after 24 hours the same key can create new work. Idempotency never makes external tool effects exactly-once.

## Limits

- Keys are not for browsers or mobile apps that cannot keep a secret.
- `userId` is a label, not an access boundary: any key of the Project reads Threads whatever their `userId`, so the backend decides which end user may see which Thread.
- v2 has no Project-wide Thread list. A Thread created inline has no Agent, so only its ID reaches it; store the ID.
- An `inline` source carries no Skills or MCP servers; use a preset for those.
- Event reads return at most the latest `PUBLIC_THREAD_EVENTS_MAX_LIMIT` events and have no cursor for older ones, so a caller that falls further behind cannot re-read the gap.

## Compatibility

- `/api/v1` stays wire-compatible ([SPEC](../SPEC.md) section 6): existing fields, accepted values, operations and documented behavior are never removed or narrowed in place, and a change that cannot stay compatible ships as a new version.
- `just public-api-openapi-check`, part of `bun run check`, fails when a generated document is stale or when v1 changes incompatibly against `main`.
