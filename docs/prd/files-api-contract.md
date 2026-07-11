# Files API — current internal contract

Status: active internal ownership and service contract. This document does not
define a second Public Thread HTTP schema.

Exact authorities:

- file records and upload DTOs: `pkgs/contracts/src/file/file.contract.ts`;
- API facade and current orchestration: `apps/api/src/modules/files/application/file-store.ts`;
- Public Thread routes and wire shapes: `GET /api/v1/openapi.json`;
- product-readable Thread semantics: [Thread Files](./session-files.md).

## Product boundary

Mosoo currently ships one user-facing file write context: **Thread files**,
attachments and runtime artifacts owned by one backing Session. The App Files
page is a read/filter/download projection over accessible records; it has no
library create/upload action.

The contract retains a `library` scope and copy-on-write/versioning plumbing,
but the HTTP upload path rejects that target and GraphQL has no library-create
mutation. Treat it as dormant infrastructure, not a shipped Files Library.

The file contract also supports account-owned files, temporary Agent package
files, and internal pre-Thread drafts. Those scopes support existing product
flows; they are not additional file-library products.

| Scope           | Current meaning                                                                |
| --------------- | ------------------------------------------------------------------------------ |
| `account`       | Account-owned material such as an avatar.                                      |
| `agent_package` | Temporary import/export package material owned by an App.                      |
| `app_draft`     | Internal staging scope used before a Public API file is claimed into a Thread. |
| `library`       | Reserved App-owned record type; no shipped user create/upload path.            |
| `session`       | Thread attachment or runtime-produced artifact.                                |

There is no generic Memory product, open-ended Resource union, App source tree,
template store, or runtime-writable shared library in this contract.

## Current service boundary

`fileStore` is the production-module facade. Agents, Files GraphQL, Public API,
Runtime, and Sessions call its exported operations for upload, access, listing,
claiming, deletion, Session materialization, and runtime-output recording.

The facade currently composes functions from `files/infrastructure` directly.
There is no implemented `ObjectStore`, `FileRecordStore`, or `FileLock` port
layer, no `application/ports` directory, and no lint-enforced import boundary to
claim here. Tests may import infrastructure helpers directly.

## Public Thread inbound flow

The shipped public flow is:

```text
POST /api/v1/agents/{agentId}/files (multipart field: file)
  -> Agent/App admission
  -> ready response.file.id in internal app_draft scope
  -> Thread create or user_message resources[].file_id reference
  -> Thread admission
  -> fileStore.ensureClaimable / claimToSession
  -> ready Session attachment
  -> Run queues with that message's attachment id
```

There is no public create-upload → `PUT` → complete workflow and no
`POST /api/v1/threads/{threadId}/files` route. Draft claiming is an internal
transition, not a public API step.

Thread file list, metadata, content, and removal use the routes in the checked-in
OpenAPI document. Public upload returns `file.id`; request resources use the
snake-case field `file_id`.

## Web and GraphQL upload flow

Web/GraphQL upload paths can use the internal multi-step upload lifecycle:
create, put single content or multipart parts, complete, and abort. A Session
resource upload creates a Session attachment directly and publishes
`session.files.updated` after completion.

`createSessionResourceUpload` currently enforces a 100-attachment Session limit.
The Public API draft-claim path does not yet enforce that same aggregate limit,
so 100 files is not a universal Public Thread API guarantee.

Claimed files remain listable on the Session, but dispatch materializes only the
attachment ids supplied with the current user message. It does not automatically
mount every ready Session attachment on every later turn.

## Runtime output flow

Runtime `file.changed` / `file.change.updated` events are admitted only for the
Session output directory. The API reads the declared output, records it through
`fileStore.recordRuntimeOutput`, stores it as
`scope=session` / `sessionKind=artifact`, and publishes
`session.files.updated`.

Runtime output never enters the reserved App library scope. Attachments are
user/caller input; artifacts are runtime output. Both remain scoped to the
Thread's backing Session.

The current runtime-output path buffers the declared file in API memory and has
no explicit per-output/aggregate byte limit before recording.

## Access and lifecycle invariants

- If a library record exists, access is App-scoped; no current user flow creates one.
- Session file access proves the Session belongs to that App and the viewer is
  admitted to the Session.
- A Public API upload is admitted against the Agent and its App before a Thread
  exists; later reference and claim are admitted against the target Thread.
- An `app_draft` file cannot be used as proof of ownership and cannot be claimed
  across App/caller boundaries.
- `app_draft.expires_at` is stored, but current claim logic does not reject a
  past expiry timestamp.
- Runtime mount paths and object keys are private implementation details.
- Removing a Session file publishes `session.files.updated`; deleting a Session
  runs scoped file cleanup.
- Public file claim and deletion/removal re-check the Session writable
  lifecycle. Archived, `RESCHEDULING`, and terminal Threads remain readable but
  reject file mutation.
- Secrets, runtime state, Session history, and provider-native pointers are not
  file content contracts.

## Non-goals

- App templates, a generated project workspace, or deployable source tree.
- A whole-App package or whole-App Skill.
- Cross-App or cross-Thread file sharing by carrying a file ID.
- A public runtime mount-path API.
- Runtime writes into the Files Library.
- Compatibility promises for removed shared-file names or removed Thread-file
  POST routes.
