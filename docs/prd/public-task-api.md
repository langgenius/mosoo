# Public Thread API - Legacy Public Task API Link

> **Purpose**: This file keeps the old `public-task-api.md` link readable. The current and canonical Public Thread API contract is [Public Thread API Surface](./public-thread-api-surface.md).
>
> **Current App boundary note**: The Public Thread API calls one Agent API Endpoint. The Agent owns endpoint exposure, runtime execution, and V1 Threads/Sessions. The App owns the product, API admission, resource, operations, and usage boundary around that Agent. Organization is not a public API authorization boundary in V1.
>
> **Related docs**: [SPEC](../SPEC.md), [App Boundary](./app-boundary.md), [Agent Session Contract](./agent-session-api.md), [Thread Files](./session-files.md), and [Public Thread API Surface](./public-thread-api-surface.md).

---

## 1. One-Line Positioning

Call one exposed Agent API Endpoint with an Access Token. Mosoo returns a Thread that can be read, continued, streamed, archived, unarchived, deleted, and given Thread files.

The App receives the operational and usage rollup. The Agent remains the runtime and delivery subject. The Thread remains the public conversation object.

---

## 2. Why This File Still Exists

The old Public Task API has been retired. This path remains only because older PRD links pointed here.

The current contract is:

- Public create-work noun: **Thread**.
- Public retrieve noun: **Thread**.
- Runtime implementation noun: **AgentSession / Session**.
- Public exposure noun: **Agent API Endpoint**.
- Task object: **not current V1**.

Do not reintroduce `/tasks`, `TaskSummary`, task links, current-task objects, or Session-first public naming as compatibility surfaces.

---

## 3. Concepts

| Noun                   | Current meaning                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **App**      | The product/API/resource/usage boundary. App is user-facing; App is the engineering name.                                    |
| **Agent**              | The App-local execution and delivery unit. It owns runtime execution, endpoint exposure, Channel delivery, and Threads/Sessions. |
| **Agent API Endpoint** | The public HTTPS surface exposed by one Agent.                                                                                   |
| **Public Thread API**  | The public API for creating, reading, continuing, streaming, archiving, deleting, and attaching files to Threads.                |
| **Thread**             | Public conversation object created through Web, Public Thread API, or Channel delivery.                                          |
| **AgentSession**       | Runtime record backing one Thread in V1.                                                                                         |
| **Run**                | One execution attempt inside a Thread.                                                                                           |
| **Thread file**        | Material attached to one Thread/backing Session.                                                                                 |
| **Access Token**       | Caller credential. In V1 it must belong to the App owner of the target Agent API Endpoint.                               |
| **Caller**             | The token-authenticated account issuing a public request.                                                                        |
| **Execution owner**    | The Agent owner whose App-local resources, credentials, Environment, Skills, Storage, MCP, and runtime are used.                 |

---

## 4. Admission Model

A Public Thread API request is admitted only when all of these are true:

1. The caller authenticates with an Access Token.
2. The target Agent is exposed as an active Agent API Endpoint.
3. The caller owns the App that owns the target Agent.
4. The Agent owner matches the App owner.
5. The created or retrieved Thread is backed by a Session for that Agent.
6. The backing Session inherits App from the Agent.

Tenant people state, old access rows, channel metadata, runtime ids, and historical package ids do not grant public API access in V1.

---

## 5. Route Family

The current route family is:

| Capability                  | Route shape                                    | Product meaning                             |
| --------------------------- | ---------------------------------------------- | ------------------------------------------- |
| Machine-readable API schema | `GET /api/v1/openapi.json`                     | Describe the Public Thread API for tooling. |
| Create Thread               | `POST /api/v1/agents/{agentId}/threads`        | Create a Thread for one Agent API Endpoint. |
| List endpoint Threads       | `GET /api/v1/agents/{agentId}/threads`         | List Threads for that endpoint and caller.  |
| Retrieve Thread             | `GET /api/v1/threads/{threadId}`               | Read one Thread by public Thread ID.        |
| List Thread events          | `GET /api/v1/threads/{threadId}/events`        | Read public event projections.              |
| Stream Thread events        | `GET /api/v1/threads/{threadId}/events/stream` | Stream public event projections.            |
| Post Thread events          | `POST /api/v1/threads/{threadId}/events`       | Continue, interrupt, or answer permissions. |
| Archive Thread              | `POST /api/v1/threads/{threadId}/archive`      | Archive a Thread for the caller.            |
| Unarchive Thread            | `POST /api/v1/threads/{threadId}/unarchive`    | Restore an archived Thread.                 |
| Delete Thread               | `DELETE /api/v1/threads/{threadId}`            | Delete the Thread through the public API.   |
| List Thread files           | `GET /api/v1/threads/{threadId}/files`         | List files attached to the Thread.          |
| Attach Thread file          | `POST /api/v1/threads/{threadId}/files`        | Claim a draft file into the Thread.         |
| Delete Thread file          | `DELETE /api/v1/threads/{threadId}/files/{id}` | Remove a file from the Thread.              |

Public IDs are bare Mosoo platform IDs in V1. Product examples should avoid legacy prefixed placeholder IDs.

---

## 6. Create Thread

Creating a Thread accepts:

- optional initial `input`;
- optional `files` containing staged file IDs;
- optional `client_external_ref` from the caller's system.

When `input` is present, Mosoo queues the first Run. When `input` is omitted, Mosoo creates an idle Thread that can receive its first user event later.

Example request:

```json
{
  "input": {
    "type": "user.message",
    "content": [{ "type": "text", "text": "Review this launch plan." }]
  },
  "files": [{ "file_id": "01J00000000000000000000F1" }],
  "client_external_ref": "linear-ENG-123"
}
```

Example response shape:

```json
{
  "thread": {
    "id": "01J00000000000000000000T1",
    "status": "RUNNING",
    "agent_id": "01J00000000000000000000A1",
    "last_run_id": "01J00000000000000000000R1",
    "client_external_ref": "linear-ENG-123"
  },
  "run": {
    "id": "01J00000000000000000000R1",
    "status": "queued"
  },
  "links": {
    "thread": "/threads/01J00000000000000000000T1"
  }
}
```

`run` is `null` when the Thread is created without initial input.

---

## 7. Events And Lifecycle

For each Thread:

- `GET /events` returns stable public event projections.
- `GET /events/stream` streams the same event projection as Server-Sent Events.
- `POST /events` accepts user messages, permission decisions, and user interrupts.
- Archive makes a Thread read-only to the caller until unarchived.
- Unarchive restores the Thread to the resumable public path.
- Delete removes the Thread through the public API.

Public event responses hide runtime internals such as driver ids, trace ids, native resume pointers, raw vendor payloads, sandbox paths, and private diagnostics.

---

## 8. Thread Files

Thread files are not one-message attachments and not App-wide Storage.

The current public file flow is:

1. A caller stages a draft file through the upload path.
2. `POST /api/v1/threads/{threadId}/files` claims the staged file into the admitted Thread.
3. `GET /api/v1/threads/{threadId}/files` lists public Thread file metadata.
4. `DELETE /api/v1/threads/{threadId}/files/{id}` removes a file from that Thread.
5. The Agent sees the current ready file set through the next user-turn Session manifest.

Public responses do not expose runtime mount paths, object keys, trace ids, or native runtime file pointers.

---

## 9. Idempotency And Rate Limits

Thread creation and event mutation paths support idempotency keyed by caller token, route, method, body hash, and idempotency key. Replayed completed requests return the stored response. Conflicting in-flight or body-mismatched requests fail closed.

The public API also rate-limits requests per Access Token bucket and returns retry information when the bucket is exhausted.

---

## 10. Channel Boundary

Channels such as Slack, Lark, Discord, Telegram, and WeChat do not call the Public Thread API.

They are App-owned delivery resources with their own provider credentials, signature verification, external thread mapping, and reply write-back. A Channel binding can create or continue an AgentSession through its adapter path, but it does not become a public HTTPS API caller.

```text
External developers / SaaS / CLI -> Public Thread API
Slack / Lark / Discord / WeChat  -> Channel binding + adapter path
Web users                        -> App Threads
```

---

## 11. Legacy Guardrails

- Do not add `/tasks` as an alias, deprecated route, or shadow route.
- Do not add a current Task object.
- Do not add `TaskSummary`, Task links, or Task next-action wrappers.
- Do not make Session the public create/retrieve noun.
- Do not describe the target as anything other than an Agent API Endpoint.
- Do not use tenant people records, old role matrices, sharing, or legacy access rows as public API admission.

---

> This file explains the current Thread-first API from the old filename. Use [Public Thread API Surface](./public-thread-api-surface.md) for the canonical product contract.
