# Thread Files — current product and runtime contract

Status: active current-state contract. Upload, link, metadata, download, and
message-level attachment paths and writable-lifecycle enforcement are shipped.
Automatic attachment materialization remains intentionally limited as
documented below.

Thread is the product noun; Session is the backing runtime record. Exact wire
shapes are generated in `GET /api/v1/openapi.json`, and internal file DTOs live
in `pkgs/contracts/src/file/file.contract.ts`.

## File contexts

The shipped write context is **Thread files**: caller attachments and runtime
artifacts scoped to one backing Session. The App Files page can list, filter,
and download accessible records, but it has no current library create/upload
path. `scope=library` is dormant contract/service plumbing and is not mounted as
a shared runtime filesystem.

Internal `app_draft` records stage a Public API upload before it is claimed into
a Thread. They are not a public draft/upload state machine.

## Web flow

- New Thread compose can upload selected files after Session creation and sends
  those `attachmentIds` with the first user input.
- An existing Agent Session composer can upload a Session resource directly.
- Thread detail follow-up currently has no attachment picker.
- Web `createSessionResourceUpload` rejects a 101st Session attachment.
- The old chat Files Panel and drag-to-panel surface are not rendered.

The internal Web uploader is browser-resumable. It creates an upload, uses one
signed PUT for a small file or multipart PUTs with at most eight parts in
flight, then completes the upload. The browser stores the original Blob and
uploaded-part state in IndexedDB. On a later protected-page load, the same
browser profile can choose Resume, Later, or Discard; multiple pending files
resume one at a time. Recovery is bounded by the server-side upload state and
expiry, and a terminal or missing (404) upload clears the local record. This is
browser-local recovery, not a Public API workflow or a cross-device guarantee.

## Public API flow

```text
POST /api/v1/agents/{agentId}/files   multipart field `file`
  -> Agent/App/caller admission
  -> ready response.file.id in internal app_draft scope
  -> reference as resources[].file_id in Thread create or user_message
  -> target Thread admission + caller/App checks
  -> claim into scope=session / kind=attachment
  -> queue the Run with that message's attachment ids
```

There is no public create-upload → `PUT` → complete workflow and no
`POST /api/v1/threads/{threadId}/files` route.

Public file routes support metadata, content download, Thread file listing,
draft/Thread file deletion, and Thread-file removal. Upload responses use
`file.id`; request resources use `file_id`.

## Runtime visibility

Claimed attachments remain visible in Thread file-list APIs until removed, but
the current run pipeline does **not** automatically inject every ready Thread
file on every later turn. `queueSessionRun` passes only the `attachmentIds`
supplied with that message; dispatch/materialization filters to those ids.

Consequences:

- files referenced on the first message are available to that Run;
- a Public API caller can reference additional files on a later `user_message`;
- a later message with no attachment ids receives no automatic all-files
  manifest, even though earlier files remain attached/listable on the Thread.

Any story that promises persistent automatic re-injection of all ready files on
each turn is not implemented.

## Runtime output

Admitted `file.changed` / `file.change.updated` events for the Session output
directory are read and recorded as `scope=session`, `kind=artifact`. The API
then publishes `session.files.updated`. Artifacts do not enter the App Files
library scope automatically.

The runtime-output path performs one bounded `max + 1` read per candidate; it
does not call the Sandbox SDK's unbounded `readFile`. The 8 MiB per-file limit
is a hard read bound. The 32 MiB / 100-artifact Session budgets are currently
best-effort admission checks: concurrent event handlers can observe the same
remaining budget and temporarily exceed the aggregate. Files seen beyond the
observed budget are skipped and logged. Runtime output also writes R2 before
the metadata row; a later database failure can leave an object that requires
storage reconciliation.

## Access boundary

- Pre-Thread upload proves the Agent, App, and caller.
- Claim/list/read/remove proves the target Thread and its backing Session/App.
- Cross-App, cross-caller, and cross-Thread ids fail closed.
- Runtime paths and object keys are platform-owned and never caller-provided.
- Channel metadata, package ids, runtime ids, and old tenant people state do not
  prove file access.
- Deleting a Session runs scoped file cleanup.

## Current limits and gaps

- Public upload accepts at most 8 MiB per file and creates an `app_draft` with a
  24-hour expiry timestamp. OpenAPI declares the byte cap; the draft expiry is
  still an internal lifecycle fact rather than a public response field.
- Claim rejects an `app_draft` whose `expires_at` is in the past. Cleanup first
  marks the record `deleting` and its upload `expired`, then deletes R2 and both
  control rows. If R2/finalization fails, that durable row remains discoverable
  and a later claim attempt retries cleanup before rejecting again.
- Public draft claim enforces the shared 100-attachment aggregate limit with
  an all-or-none compare-and-swap across the request's unique file IDs.
- Public upload trusts the multipart `File.type` value as MIME metadata; it does
  not content-detect MIME.
- The route performs authentication and rate limiting before bounded multipart
  parsing, and requires exactly one `file` field; duplicate or unrelated fields
  are rejected.
- Public event mutation preflights every requested action against the current
  Session lifecycle before referenced drafts are claimed.
- Public draft claim and file DELETE/remove share the writable-lifecycle guard:
  archived, `RESCHEDULING`, and terminal Threads reject file mutation.
- Draft claim copies every destination first, then commits all eligible file
  rows in one guarded D1 batch. If the database claim fails, copied destination
  objects are removed and no draft row changes owner.
- After a successful database claim, deleting the old draft object is
  best-effort. A crash or storage failure can therefore leave an unreachable
  source object until storage reconciliation exists. If later Run creation
  fails, already-claimed attachments remain on the Thread for explicit reuse or
  removal; the file claim and Run creation are not one transaction.

These are current implementation facts. MIME detection, durable reconciliation
of post-claim source objects, and transactional coupling between claim and Run
creation remain follow-up hardening work rather than stronger guarantees.

## Non-goals

- a whole-App package, App template, or App source tree;
- a runtime-writable shared Files Library mount;
- cross-App or cross-Thread sharing by carrying a file id;
- caller-supplied runtime mount paths;
- secrets, native runtime state, or Session history as file content contracts.
