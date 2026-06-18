# Thread Files - For-Human PRD

> **Purpose**: This is the product-readable contract for files attached to Mosoo Threads. The implementation uses Session file/resource records, upload targets, runtime manifest injection, and the Public Thread file API.
>
> **Current App boundary note**: Thread is the V1 product noun. A Thread file belongs to one backing AgentSession, and that Session inherits App from its Agent. File operations must use the admitted Session's App proof; runtime ids, package ids, channel metadata, old draft scopes, or tenant people state cannot prove access.
>
> **Current UI status**: Web currently exposes composer paperclip upload for Thread/Session files. The old in-chat Files Panel and drag-to-panel entry points are not rendered. Public Thread API exposes list / attach / delete Thread file routes. Runtime behavior is unchanged: the Agent receives the current Session file manifest on the next user turn.
>
> **Related docs**: [SPEC](../SPEC.md), [App Boundary](./app-boundary.md), [Agent Session Contract](./agent-session-api.md), and [Public API Surface](./public-thread-api-surface.md).

---

## 1. TL;DR

A Thread file is material attached to one Thread and its backing AgentSession.

- New Web Thread creation can attach local files through the composer paperclip.
- Public Thread API callers can attach draft files to a Thread through the Thread file routes.
- Channel delivery can normalize provider input into Session context, but it is not a public Thread file caller.
- The runtime sees attached files only through the Session file manifest injected into a user turn.
- The file follows the Thread/Session lifecycle; it is not a one-message attachment and not App-wide Storage.

The mental model is:

```text
App
  -> Agent
    -> Thread
      -> AgentSession
        -> Thread files / Session files
          -> next user turn manifest
```

---

## 2. User Problem

Owners and API callers often need to hand a CSV, spec, screenshot, log, or small document to the Agent for a specific Thread.

The product must avoid three failure modes:

- A file is treated as a one-off message attachment and silently disappears on the next turn.
- A file uploaded in one Thread leaks into another Thread, another Agent, or App-wide Storage.
- The public API exposes runtime mount paths or private file/resource implementation details.

The expected behavior is simple:

> "This file belongs to this Thread. The Agent can use it on future turns in this Thread until I remove it or delete the Thread."

---

## 3. Goals

- Keep one file concept across Web Threads and the Public Thread API.
- Scope every file to exactly one backing Session and therefore one App.
- Reuse the same runtime manifest injection for Web-created and API-created Threads.
- Keep public responses Thread-first and metadata-only.
- Reject cross-App, wrong-Thread, wrong-caller, stale-draft, and unknown file references.
- Keep Channel delivery outside the public file API; channel adapters normalize provider events before they touch Session input.
- Preserve the 100-file limit per Session.

---

## 4. Concept Definitions

| Term                      | Product definition                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Thread file**           | Public/API noun for material attached to one Thread.                                                                |
| **Session file**          | Implementation noun for the same material on the backing AgentSession.                                              |
| **Session resource**      | Internal GraphQL/service noun for an attached Session file used by Web and runtime paths.                           |
| **Draft file**            | Uploaded file staged before being claimed into a Thread. It has no runtime meaning until the Thread claim succeeds. |
| **Attachment**            | Internal file kind for user-provided material. It must not reintroduce one-message-only semantics.                  |
| **Artifact**              | Runtime-produced file. It can appear in Thread file projections, but is not uploaded by a caller as an input file.  |
| **Runtime manifest**      | The list of currently attached Session files injected into the next user turn with read-only paths for the runtime. |
| **Channel provider file** | File-like content received from Slack, Lark, Telegram, Discord, WeChat, or another provider. It must be normalized. |
| **Files Library**         | General uploaded file pool. It is separate from Thread files unless a file is explicitly scoped to a Session.        |
| **App ownership** | The boundary inherited from Agent -> Thread -> Session. File access is checked against that boundary.               |

---

## 5. Entry Points

### 5.1 Web Threads

Current Web upload behavior:

1. The active App supplies `appId`.
2. New Thread creation may include selected files; after the Thread is created, Web uploads those files as Session resources and sends their `attachmentIds` with the first input.
3. The Agent Session panel can upload through its composer paperclip after an active Session exists.
4. Existing Thread replies do not currently attach more files from the Thread detail composer.
5. Follow-up user input sends normal Session events; the runtime manifest includes the ready files.

Current Web caveat:

- There is no rendered Files Panel in the chat header.
- Pending and failed upload state may be shown near the composer.
- The product target can reintroduce a list/management panel later, but the current contract must not pretend it is already the active source of truth in Web UI.

### 5.2 Public Thread API

Public API behavior:

1. The caller authenticates with an Access Token.
2. The target Thread is admitted through Public Thread API access checks.
3. File operations use the admitted Thread's backing Session App.
4. `GET /api/v1/threads/{threadId}/files` returns public Thread file metadata.
5. `POST /api/v1/threads/{threadId}/files` claims a staged file into the Thread.
6. `DELETE /api/v1/threads/{threadId}/files/{fileId}` removes a file from the Thread.

Public responses do not expose runtime mount paths, private object keys, trace ids, or native runtime pointers.

### 5.3 Channel Delivery

Channel delivery is not a public file caller:

- The App owns Channel setup and provider credentials.
- One Agent owns the Channel binding and delivery behavior.
- Provider events and provider file-like payloads are verified and normalized by the adapter path.
- The adapter may create or continue the AgentSession for the bound Agent.
- It must not bypass Thread/Session App proof or call the public HTTPS Thread file routes as a substitute for adapter admission.

---

## 6. Lifecycle

| State                 | Meaning                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| **Draft**             | Uploaded or staged, but not yet attached to a Thread.                      |
| **Ready attachment**  | Attached to one Thread/Session and available for the next manifest.        |
| **Referenced in Run** | Included in the manifest for a user turn; the runtime can read the paths.  |
| **Removed**           | Deleted from the Thread file set; future turns no longer include it.       |
| **Archived Thread**   | Thread is read-only; files remain part of the Thread record.               |
| **Deleted Thread**    | Thread cleanup deletes Session files and associated runtime file material. |

Lifecycle rules:

- Uploading a file does not interrupt a currently running Run.
- Deleting a file does not rewrite historical messages.
- A file added or removed during a Run affects the next user turn, not the active Run.
- Existing Sessions keep their own file set when Agent config changes.
- A file cannot migrate to another Thread by carrying a file id across boundaries.

---

## 7. Runtime Manifest Behavior

The Agent does not watch the file set.

On each user message, Mosoo lists the current ready Session files for that backing Session and injects a manifest into the runtime prompt/context. The manifest is an execution aid, not a public API contract.

Observable behavior:

- Upload, then close the Thread without another message: the file is attached, but the Agent has not seen it yet.
- Upload, then send a message: the Agent sees the file in that turn's manifest.
- Delete, then send a message: the deleted file is absent from the manifest.
- Public API file metadata can be stable while runtime mount paths remain private.

Runtime adapters receive ordinary input plus the manifest. They should not need provider-specific Session file logic.

---

## 8. Fail-closed Invariants

- Web file upload requires an active App and an admitted Session.
- Public file routes require Public Thread admission before listing, claiming, or deleting files.
- The admitted Thread's Session App is the only file access boundary.
- Draft files must be claimed by the same admitted caller path before they become Thread files.
- A file id from another Session, another App, a stale draft, or a legacy package cannot be reused as ownership proof.
- Runtime mount paths are derived by the platform and are never caller-provided.
- Channel provider metadata cannot prove Mosoo file access.
- Unknown public file request fields are rejected.
- The 100-file Session limit is enforced before accepting another upload.

---

## 9. Out Of Scope

- App-wide file libraries.
- Cross-Thread file reuse.
- Cross-Agent file sharing.
- Files that grant access through tenant people state.
- A public mount-path API.
- A Channel provider file API that bypasses adapter admission.
- A user-visible Files Panel until the Web surface is rebuilt.

---

> This PRD defines Thread/Session file semantics. Public docs should lead with Thread files. Implementation docs may use Session files or Session resources when explaining code, storage, and runtime manifest behavior.
