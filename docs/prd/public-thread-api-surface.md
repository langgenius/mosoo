# Public Thread API

Status: Available for Project-owner integrations with an application-user identity. The
exact HTTP contract is the
[OpenAPI document](https://cloud.mosoo.ai/api/v1/openapi.json).

## Why it exists

Builders need to use a mosoo Agent from their own product without learning how
it runs. The Public Thread API makes each conversation or job a durable Thread
that an integration can start, follow, continue, and recover.

## Who uses it

- A Project owner connects an exposed Agent to a server-side integration.
- A Project user may trigger that integration, but authenticates with the Builder's
  product rather than directly with mosoo.

## User flow

1. The owner exposes an Agent, creates a Project API key, and stores it on a
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

- API keys belong to one Project. The Agent must be exposed and remain inside
  that Project, even when the same owner has other Projects. Rotation does not
  change Thread ownership; another key in that Project can continue the Thread.
- `userId` is supplied only by the trusted backend, is immutable after Thread
  creation, and scopes the Thread, its Runs, files, and delegated MCP calls.
- The identity boundary is `(Project, userId)`. A user may own multiple Threads;
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
  `(project_id, tool_call_id)` and return its stored result when the call is
  delivered again.
- Thread files include explicit attachments and recorded Agent artifacts, not a
  complete runtime workspace. Thread history also does not guarantee that every
  later Run receives prior private runtime state or every earlier file.

## Unreleased saved-Agent entry point

`/api/v2` reuses the Thread lifecycle and conversation ID for the #582 admission
transition. A Project key can invoke a private Agent by ID without publishing.
A new Thread captures the latest saved configuration, even when the Agent has
an older published version; later Agent edits do not change that snapshot.
Omitting `userId` stores no end-user identity and returns `userId: null`. A
supplied value remains immutable and carries the existing delegated MCP identity.

Read, events, continuation, cancellation, and file access use the Session's owner
and Project boundary, regardless of the creation channel or current publication
state. The same ID addresses an existing owned Session. This does not grant a
Project key access to another Project or invent missing recovery state.

The new version is required because latest-saved admission differs from v1's
published/live behavior. It does not rename Thread resources or retire v1.
Existing v1 callers keep their published configuration and required `userId`;
v2-created Threads are excluded from v1's public-channel view. The #582 release
requires a model-provider account configured in the Project (BYOK). Turn budgets
and the shared-workspace transition remain #582 work; platform-funded first use,
recharge, and commercial billing are independent #636 scope.

New isolated v2 Sessions admit a 30-day recovery period from the last successful
turn, renewed on success. Expired continuation returns `readiness_blocked` with
an explicit expiry time; history, events, usage and saved files remain readable.
Input received after expiry does not retitle the Session or claim new draft files.
The server records one request time for both file claim and Run admission, so a
transfer begun before expiry may finish afterward. Other admission failures can
leave supplied files attached to the Session.
Existing Sessions without a recorded recovery policy are not retroactively
expired. This admission rule does not by itself prove cold or multi-day restore;
see [Thread Continuation](./thread-continuation.md#retention-and-deletion).

`GET /api/v2/threads/{threadId}/usage` returns paginated persisted runtime usage
observations. Missing values remain null. Token accounting follows the recorded
provider convention; runtime cost estimates are not invoices. Empty observations
do not establish that no inference occurred. The endpoint reads Session records,
so it does not lose observations when the seven-day billing detail rolls up.

The [executable workflow](../../scripts/public-api-session-workflow.ts) is the
shared HTTP acceptance example for clients, CLI, and documentation. It uses one
`thread.id` for create/read, real tools and artifact download, SSE, usage,
follow-up with private workspace state, and cancellation without a Run ID.
Run `just public-api-session-workflow` with a nonproduction `/api/v2` URL in
`MOSOO_PUBLIC_SESSION_BASE_URL`, a saved Agent ID in
`MOSOO_PUBLIC_SESSION_AGENT_ID`, a Project key in `MOSOO_API_TOKEN`, and a unique
`MOSOO_PUBLIC_SESSION_TEST_ID`. Use `MOSOO_E2E_ENV_FILE` for a local ignored key
file. It runs real inference and leaves its Session/artifacts available for
inspection; use a fresh test ID for a full rerun. Evidence goes to
`.tmp/e2e/session-workflow` or `MOSOO_PUBLIC_SESSION_OUTPUT_DIR`.

### Creation retries

An optional `Idempotency-Key` is shared by keys in the same Project. Retained
receipts reject changed input and replay the same admitted Session. The current
receipt window is 24 hours; callers must save the returned Thread ID, because
reuse after expiry can create new work. A still-processing request returns 409.
After ten minutes, a retry can reconcile an interrupted creation against its
persisted Session, initial-turn receipt, configuration and file identities.
An unrelated later turn is not evidence that the original input was admitted.

An ambiguous infrastructure failure keeps the creation recoverable; it must not
delete an admitted Run or an object that a committed file record may reference.
Explicit request rejections remain replayable. Neither creation idempotency nor
recovery guarantees exactly-once effects in external tools.

## `/api/v1` compatibility policy

The #582 durable Session target can extend this Thread API. Keeping the Thread
name, existing conversation IDs, or compatible Run result fields does not
conflict with one primary conversation handle. A terminology change alone does
not require a new version or removal of the old routes. Assess admission,
configuration selection, identity, continuation, and outcomes separately.

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
