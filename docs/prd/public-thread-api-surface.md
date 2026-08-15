# Public Thread API

Status: Available for App-owner integrations with an application-user identity. The
exact HTTP contract is the
[OpenAPI document](https://cloud.mosoo.ai/api/v1/openapi.json).

## Why it exists

Builders need to use a mosoo Agent from their own product without learning how
it runs. The Public Thread API makes each conversation or job a durable Thread
that an integration can start, follow, continue, and recover.

## Who uses it

- An App owner connects an exposed Agent to a server-side integration.
- An App user may trigger that integration, but authenticates with the Builder's
  product rather than directly with mosoo.

## User flow

1. The owner exposes an Agent, creates an Access Token, and stores it on a
   trusted backend.
2. After authenticating its user, the backend creates a Thread with that user's
   opaque `userId`, empty or with an initial message and files.
3. It reads or streams public events, checks the latest Run, and can send a
   follow-up, answer a permission request, or interrupt work.
4. It can list, retrieve, archive, restore, or delete Threads, and upload,
   attach, download, or remove Thread files.

## What is available now

The core Thread lifecycle, public event feed, and file workflow are usable. The
Agent's API Access panel shows its identifier, token creation, and API reference.

## User-visible boundaries

- Access Tokens belong to the App owner. The Agent must be exposed, owned by
  that same owner, and remain inside the same App.
- `userId` is supplied only by the trusted backend, is immutable after Thread
  creation, and scopes the Thread, its Runs, files, and delegated MCP calls.
- The identity boundary is `(App, userId)`. A user may own multiple Threads;
  `userId` is not a unique Thread key.
- mosoo records this opaque identifier but does not authenticate the End User.
  The Builder's product remains responsible for login and authorization.
- Tokens are backend secrets and are not suitable for browser or mobile clients
  that cannot keep them private.
- Public events show stable progress and outcomes, not private diagnostics or
  raw runtime data.
- Tool lifecycle events expose an opaque `toolCallId`; start events also expose
  `toolName` and complete structured `toolInput` when available. Consumers use
  `toolCallId` to correlate start, confirmation, and terminal events across
  listing, replay, and SSE reconnects instead of pairing human-readable text.
- `toolCallId` is an idempotency key, not an exactly-once guarantee. A
  write-capable integration should enforce a uniqueness boundary such as
  `(app_id, tool_call_id)` and return its stored result when the call is
  delivered again.
- Thread files include explicit attachments and recorded Agent artifacts, not a
  complete runtime workspace. Thread history also does not guarantee that every
  later Run receives prior private runtime state or every earlier file.

## `/api/v1` compatibility policy

`/api/v1` is backward compatible by default. Existing request fields, accepted
values, response fields, operations, and documented behavior must not be removed
or narrowed in place. A semantic change that cannot remain compatible must use a
new versioned endpoint.

Staged enforcement inside v1 is reserved for security or correctness boundaries
that cannot safely remain permissive. It must first ship an additive compatibility
phase, publish a minimum supported client version and enforcement date, and record
those facts in the compatibility approval consumed by the OpenAPI breaking-change
gate (`config/public-api-v1-breaking-change-approvals.json`). Each approval is
bound to the normalized base OpenAPI digest, the compatibility issue, minimum
client version, and rollout dates. The old shape remains accepted until that
phase is complete. Documentation, generated clients, CLI/skill artifacts, and a
non-production smoke must be ready before enforcement. A production deploy is
not the place to discover downstream contract drift.

The reusable `Public API non-production smoke` workflow is the deployed release
check. It fetches the live OpenAPI, verifies the exact create contract, submits
the documented minimal `{ "userId": "..." }` body, and checks the returned
Thread identity. Its URL guard refuses every production Mosoo host; configure a
separate `public-api-nonproduction` GitHub Environment with a synthetic Agent and
Access Token. Production deployment and release remain explicit human steps.
