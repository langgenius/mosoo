# Agent Endpoint MVP — current contract

Status: active and shipped.

This document describes the current Agent Endpoint product boundary. The exact
HTTP schema is generated from the checked-in OpenAPI contract; for the full
route and response model, see [Public Thread API Surface](./public-thread-api-surface.md).

## One-line positioning

A published Mosoo Agent is an Agent API Endpoint. An authenticated backend can
create and operate Threads for that Agent through `/api/v1` without owning an
agent loop, runtime process, or sandbox lifecycle.

## Product boundary

- The Agent is the endpoint identity; V1 has no separate Endpoint database
  object.
- The Agent belongs to one App. Public Threads inherit that App's resource,
  access, usage, and operations boundary.
- First Publish creates the live Agent version used by new endpoint requests.
  Saving versioned config on an already published Agent creates and advances the
  live DeploymentVersion for future Threads; existing Sessions remain pinned to
  their original snapshot. A not-yet-published draft save creates no version.
- Pet and Cattle are runtime continuity modes. They do not create different
  public route families or request schemas.
- Runtime, model, prompt, Environment, Skills, MCP bindings, and provider
  options come from the published Agent. A public request cannot override them.

## Access contract

1. The caller authenticates with an Access Token.
2. The target Agent must be published and exposed as an active API endpoint.
3. The caller must own the App that owns the Agent.
4. A created Thread is attributed to the admitted Access Token account.

`attributed_user` therefore identifies the Mosoo account associated with the
admitted token. It is not an end user from the developer's application.

## Create Thread

```http
POST /api/v1/agents/{agentId}/threads
Authorization: Bearer <access-token>
Content-Type: application/json
Idempotency-Key: <optional-key>
```

```json
{
  "input": {
    "type": "user.message",
    "content": [{ "type": "text", "text": "Improve this resume" }]
  },
  "resources": [{ "type": "file", "file_id": "01J00000000000000000000F1" }],
  "client_external_ref": "resume-review-123"
}
```

All body fields are optional:

| Field                 | Meaning                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `input`               | Initial `user.message`. Omitting it creates an IDLE Thread with no Run.                                                 |
| `resources`           | Files uploaded through `POST /api/v1/agents/{agentId}/files`; only `{ "type": "file", "file_id": "..." }` is accepted.  |
| `client_external_ref` | Optional caller-owned correlation string. It is not unique, an identity, an authorization input, or an idempotency key. |

The request parser rejects unknown fields. In particular, `end_user_id`,
`files`, `external_session_id`, arbitrary metadata, and per-request runtime
settings are not part of the current contract. Request replay protection uses
the optional `Idempotency-Key` HTTP header, not a JSON field. The key is unique
within the authenticated Access Token; method, route, and parsed body are its
fingerprint, and reusing the same scoped key for a different fingerprint returns
`idempotency_conflict`. Create Thread stores a rendered operation error once the
operation begins, so the same key replays that response; parse, admission, and
rate-limit failures that happen before the operation are not stored.

## File flow

1. Upload bytes with multipart field `file` to
   `POST /api/v1/agents/{agentId}/files`.
2. Read the returned `file.id`.
3. Reference it through `resources` when creating a Thread or posting a
   `user_message` event.
4. Mosoo claims the App draft file into that Thread. With an initial input or
   follow-up `user_message`, the claimed file ids are attached to the Run that
   message queues. A resources-only Thread create claims and links the files but
   leaves the Thread `IDLE` with no Run.

There is no `POST /api/v1/threads/{threadId}/files` route. After attachment,
callers can list files with `GET /api/v1/threads/{threadId}/files` and remove one
with `DELETE /api/v1/threads/{threadId}/files/{fileId}` or
`DELETE /api/v1/files/{fileId}`.

See [Thread Files](./session-files.md) for lifecycle semantics.

## Thread operations

The current API supports:

- list an Agent endpoint's Threads;
- retrieve a Thread;
- list or stream projected events;
- post user messages, permission decisions, and interrupts;
- archive and unarchive a Thread explicitly;
- delete a Thread explicitly;
- retrieve, download, list, and delete files.

The machine-readable contract is available at `GET /api/v1/openapi.json`.
Public responses intentionally omit driver IDs, sandbox paths, vendor resume
pointers, raw runtime payloads, and deployment internals.

## Runtime and permission behavior

The public contract does not promise that every endpoint runs in Cattle mode,
uses `full_access`, or suppresses every permission request. Those behaviors are
derived from the published Agent and the selected runtime. When a runtime emits
a permission request, the Public Thread API can accept a
`permission_decision` event through the normal Thread event route.

## Console boundary

Console remains the management surface for the Agent draft, publish state,
runtime configuration, API access guidance, Threads, and logs. It is not a
second public API and does not change the `/api/v1` contract.

For a published Agent, the Publish menu can copy a coding-agent instruction
Markdown template. The template contains only platform-owned Agent/API
coordinates, the Pet/Cattle Sandbox boundary, OpenAPI/docs URLs, and guidance to
read the Access Token from `MOSOO_API_TOKEN`; it excludes user-authored Agent
name, description, and prompt text. This is a convenience wrapper around the
same Public Thread API. It is not a `Skill.md`, Agent/App package or export,
generated application, IDE integration, or third-party compatibility promise.
The checked-in OpenAPI document remains the wire-contract authority.

## Non-goals

- A separate Endpoint lifecycle object.
- App-level API endpoints.
- Public developer-customer identity management.
- Per-request runtime, model, sandbox, or provider overrides.
- Public exposure of raw runtime and driver internals.
- Different public APIs for Pet and Cattle Agents.
