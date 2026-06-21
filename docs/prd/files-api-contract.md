# Files API — Library And Session Artifacts Contract

Status: revised MVP contract after OpenMA/VibeSDK product review (YEF-674)
Scope: `apps/api/src/modules/files`, `pkgs/contracts/src/file`, and every module that reaches into file storage internals (`runtime`, `sessions`, `public-api`, `api-command`, `agents`, `agent-builder`).

This document defines the MVP product contract for an App-scoped **Files Library** plus **session-scoped attachments/artifacts**. It deliberately does **not** introduce an App source tree, a generic `resources[]` model, `Mount` union, Memory Store, or Claude adapter contract. Those are separate products/contracts only when they exist. The MVP fixes the current leak by separating session data from non-session file records and removing the old shared-file product/API/Manifest surface.

---

## 1. Why this exists — the original service-layer failure

Before this pre-launch refactor, the Files API was ~4,500 lines across ~40 files split into `application/` and `infrastructure/`. The domain model in `pkgs/contracts/src/file/file.contract.ts` was actually coherent (a scope-polymorphic `FileRecord`, a single `createFileObjectKey` projection, normalized paths). The damage was in the **service layer**, which had no facade:

- **The "application" layer was thin.** `application/file-http.service.ts` re-exported functions straight out of `infrastructure/*` (`file-upload-create`, `file-content-service`, `file-upload-transfer`, `file-update`, …). It added little orchestration. There was no composed `class`/port — services were loose functions.
- **There was no single entry point.** Callers had to know which infrastructure file exported the function they needed. Agents used `agent-package-file.service`, sessions used `session-resource-file.service`, and library operations used file infrastructure directly — each re-validating access and re-doing record transforms.
- **Cross-module reach-through existed.** `public-api/public-thread-file-api.service.ts` imported `files/infrastructure/file-record-store` and `files/infrastructure/file-errors` directly. Runtime and session modules knew too much about storage paths and record shapes.
- **One logical operation had many code paths.** "Delete a file" and "Write a file" were spread across upload, content, cleanup, draft-claim, and session-resource services instead of a single application boundary.
- **Asymmetric features by scope were implicit.** Move/rename and versioning were implemented for Files Library records while other scopes had separate paths. The refactor requires descriptor-declared scope capabilities so adding a scope kind is a registration exercise, not another branch ladder.
- **The session/non-session boundary was the load-bearing bug.** Runtime output used to be recorded into a persistent shared tree and then only labelled as a session artifact in the view. The MVP contract fixes this by making every runtime output a session-scoped artifact by construction.
- **Parallel representations still need consolidation.** The path hierarchy already implied by `fileRecordsTable.path` should be the canonical tree model; any extra directory/index table must be justified by a real access path, not by product naming history.
- **The "facades" that aren't.** `infrastructure/file-record-store.ts` and `infrastructure/r2-s3-client.ts` claim to be unified entry points but only re-export `file-record-{queries,mutations,access}` and `r2-s3-{object,multipart}-client`; callers import the underlying files directly anyway.

Engineer's verdict ("the file API is completely messed up… unsalvageable in the future") is accurate about the **service/layering** surface and the **scope leak**, not the contract types.

---

## 2. Product model: Files Library and Session Artifacts

The product surface is deliberately narrow:

1. **Files Library** — a general file pool owned by one App boundary, not a generated App source tree.
2. **Session attachments** — end-user or caller supplied input files attached to a Thread/Session.
3. **Session artifacts** — runtime-produced output files attached to a Thread/Session.

There is no `Memory` product in this MVP. There is no generic `Resource` union in this MVP. There is no runtime-writable shared file contract in this MVP.

### 2.1 Files Library — the OpenMA-style baseline

Files is an App-scoped file library, not an App source tree. It gives users/API clients a durable place to upload and later reference files inside the selected App:

- `scopeKind = "library", scopeId = appId` means a library file belongs to that App's Files view.
- `scopeId = sessionId` means the file belongs to that session's file view.
- Runtime outputs are represented as session-scoped artifacts, not as library files.
- Listing supports both "all files" and "files for this session" views.

This keeps the MVP to a simple file object plus explicit App or Session scope. It avoids inventing an App asset/source system before the App Builder / publishing / generated-project model is settled.

### 2.2 Session attachments and artifacts

Session attachments and artifacts are first-class in the MVP:

- **attachment** = caller/user supplied input, materialized read-only for the runtime.
- **artifact** = runtime-produced output, downloadable from the session.

Runtime Plane writes always become session artifacts. They never write to the App Files Library by default.

### 2.3 Why Files is still not an App source tree

The old App Files proposal mixed two different products:

- a file upload/list/download API;
- an application source/asset tree used by builders, publishing, templates, generated projects, and future VibeSDK-like workflows.

For long-term VibeSDK-like product work, source files, templates, generated app assets, previews, and deployable outputs should likely live in a **Project / generated workspace / repository / template** model, not in the generic Files API. Cloudflare VibeSDK is a useful signal: it is centered on generated application projects, sandboxed previews, GitHub export, templates, R2-backed storage, and deployment surfaces rather than an App Files primitive.

Therefore the MVP should commit only to an App-scoped Files Library plus session artifacts. It should not claim that Files is the source tree, generated workspace, template store, preview output, or deployable project model.

---

## 3. The internal service boundary — `FileStore`

`FileStore` is an internal API service boundary, not a new public product contract. It is the **only** symbol API/runtime/session modules import for file persistence. It lives at `apps/api/src/modules/files/application/file-store.ts`, composed once from infrastructure adapters at module bootstrap. Everything else in `files/` becomes private.

```ts
// apps/api/src/modules/files/application/file-store.ts
// The ONE entry point. All consumers depend on this interface only.
export interface FileStore {
  // ── Upload lifecycle (replaces createFileUpload + transfer + complete + draft) ──
  createUpload(viewer: Viewer, req: CreateFileUploadRequest): Promise<FileUploadSummary>;
  getUpload(viewer: Viewer, fileId: FileId): Promise<FileUploadSummary>;
  putContent(viewer: Viewer, fileId: FileId, body: ContentBody): Promise<UploadFilePartResponse>;
  putPart(
    viewer: Viewer,
    fileId: FileId,
    partNumber: number,
    body: ContentBody,
  ): Promise<UploadFilePartResponse>;
  completeUpload(
    viewer: Viewer,
    fileId: FileId,
    req: CompleteFileUploadRequest,
  ): Promise<FileRecord>;
  abortUpload(viewer: Viewer, fileId: FileId): Promise<void>;

  // ── Records & content (replaces file-record-store + file-content-service reads) ──
  getRecord(viewer: Viewer, fileId: FileId): Promise<FileRecord>;
  streamContent(viewer: Viewer, fileId: FileId): Promise<FileContentStream>;
  createDownload(
    viewer: Viewer,
    fileId: FileId,
    disposition: "attachment" | "inline",
  ): Promise<CreateFileDownloadResponse>;

  // ── Listing (replaces legacy library list + session resource list) ──
  list(viewer: Viewer, query: FileListQuery): Promise<FileListing>;

  // ── Mutation (move/rename gated by scope capability) ──
  update(viewer: Viewer, fileId: FileId, req: UpdateFileRequest): Promise<FileRecord>;

  // ── Deletion (replaces deleteFileById + deleteFilesForScope) ──
  delete(viewer: Viewer, fileId: FileId): Promise<void>;
  deleteScope(scope: FileScope): Promise<void>;

  // ── Attachment in/out (replaces the old draft claim, session resource, and public thread file glue) ──
  claimToSession(viewer: Viewer, sessionId: SessionId, fileIds: FileId[]): Promise<FileRecord[]>;
  ensureClaimable(viewer: Viewer, sessionId: SessionId, fileIds: FileId[]): Promise<void>;
  recordRuntimeOutput(input: RuntimeOutputFileInput): Promise<FileRecord>; // always recorded session-scoped (owner=session)
}
```

All request/response DTOs (`CreateFileUploadRequest`, `FileRecord`, `FileUploadSummary`, `UpdateFileRequest`, `CreateFileDownloadResponse`, …) are reused from `pkgs/contracts/src/file/file.contract.ts` after the breaking Files rename. The MVP must not add placeholder unions for future Memory Stores, generic resources, or runtime mount sources.

### Capabilities, not scope branches

Move/rename, versioning, and locking are **declared per scope**, never branched inline:

```ts
export interface FileScopeDescriptor {
  kind: FileScopeKind; // MVP: "agent_package" | "app_draft" | "library" | "session"
  defaultPurpose: FilePurpose;
  ownerKindFor(scopeId: FileScopeId): FileOwnerKind;
  capabilities: {
    moveRename:
      | { enabled: true; normalizePath(path: string): string; eventName: string }
      | { enabled: false };
    pathLocks: boolean; // Files: true; others: false
    versioning: boolean; // Files: true; others: false
  };
  resolvePath(target: CreateFileUploadTarget): string;
  ensureAccess(viewer: Viewer, scopeId: FileScopeId): Promise<void>;
}

export const FILE_SCOPE_REGISTRY: Record<FileScopeKind, FileScopeDescriptor>;
```

`FileStore.update` consults `descriptor.capabilities.moveRename`; upload path-lock expiry consults `descriptor.capabilities.pathLocks`; `completeUpload`/`delete` consult `descriptor.capabilities.versioning`. In this MVP, scope kinds are closed over the existing file products. Do not add future-looking scope kinds until the product entity exists.

### Storage & persistence ports (single each)

```ts
export interface ObjectStore {
  // the ONE R2/S3 surface (folds r2-s3-{object,multipart,client})
  putSingle(key: string, body: ContentBody): Promise<{ etag: string }>;
  createMultipart(key: string): Promise<MultipartHandle>;
  uploadPart(h: MultipartHandle, n: number, body: ContentBody): Promise<{ etag: string }>;
  completeMultipart(h: MultipartHandle, parts: CompleteFileUploadPart[]): Promise<{ etag: string }>;
  abortMultipart(h: MultipartHandle): Promise<void>;
  copy(from: string, to: string): Promise<{ etag: string }>;
  get(key: string): Promise<ObjectBody>;
  delete(key: string): Promise<void>;
}

export interface FileRecordStore {
  // the ONE D1 surface (folds file-record-{queries,mutations,access,model})
  insertPending(rec: NewFileRecord): Promise<FileRecord>;
  markReady(fileId: FileId, etag: string, size: number): Promise<FileRecord>;
  markDeleting(fileId: FileId): Promise<void>;
  get(fileId: FileId): Promise<FileRecord | null>;
  listByScope(scope: FileScope, q: FileListQuery): Promise<FileListing>;
  transition(fileId: FileId, patch: FileRecordPatch): Promise<FileRecord>; // owner/scope/purpose/sessionKind moves
}

export interface FileLock {
  // optional future capability; descriptor decides whether it's used
  withLock<T>(scope: FileScope, path: string, fn: () => Promise<T>): Promise<T>;
}
```

`FileStore` is the only place that composes `ObjectStore` + `FileRecordStore` + optional locking + the scope registry. Versioning (`fileVersionsTable`) is invoked by `FileStore` when `descriptor.capabilities.versioning`, in exactly one place per mutating operation.

---

## 4. Layering & dependency rules

```
pkgs/contracts/src/file        ← pure types + path/key helpers (no deps)
        ▲
apps/api/.../files/application
   ├── file-store.ts        (FileStore interface + DTO re-exports)   ← consumers import ONLY this
   ├── file-scope-registry.ts
   └── ports/ {object-store, file-record-store, file-lock}.ts        (internal interfaces)
        ▲
apps/api/.../files/infrastructure       ← adapters that IMPLEMENT the ports (R2, D1, durable-object lock)
                                          PRIVATE: no symbol imported outside files/
```

**Enforced rules (lint boundary):**

1. No module outside `apps/api/src/modules/files/**` may import from `files/infrastructure/**`. Allowed import surface = `files/application/file-store` (+ the registry/types it re-exports).
2. Files access is owned by the Files module and existing tenant/account/App access policy, not by a separate shared-file domain.
3. `runtime`, `sessions`, `public-api`, `api-command`, `agents`, `agent-builder` obtain a `FileStore` (via DI/bindings) and call methods. They never re-implement upload/claim/transform.
4. Path/key helpers stay in `pkgs/contracts` and are called by the registry/adapters — not re-wrapped per module or imported from `files/infrastructure`.

A mechanical boundary test or dependency-cruiser / eslint `no-restricted-imports` rule makes rules 1–2 checkable in CI.

---

## 5. Session attachment and artifact contract

Modeled on Mosoo's current Thread/Session file behavior, not on a future generic resource contract. A file is uploaded once, gets a Mosoo `file_id`, is claimed into a Thread/Session when entering a run, and runtime outputs surface as downloadable session artifact records.

### Inbound (request → run) — the end-user journey

```
upload (app_draft scope, file_id issued)
   → FileStore.ensureClaimable(viewer, sessionId, fileIds)     // single validation gate
   → FileStore.claimToSession(viewer, sessionId, fileIds)      // ONE transactional claim:
        • ObjectStore.copy(draftKey → sessionKey)
        • FileRecordStore.transition(owner app→session, scope→session, purpose→session_attachment, sessionKind="attachment")
        • on failure: roll back the copied destination object (today's best-effort .catch becomes a guarded step)
   → run dispatched with attachmentIds (validated at claim time, not first-touched in runtime)
   → existing Session file manifest / read-only runtime materialization
```

Replaces the three independent claim entry points (`public-thread-file-api`, `public-thread-create`'s separate claimable-check + claim, `createSessionResourceUpload`) with one `claimToSession` / `ensureClaimable` pair. `api-command` validates `attachmentIds` against `FileStore.getRecord` before queueing.

### Outbound (run → reply) — default `scope=session`, not shared library

```
sandbox file mutation event
   → FileStore.recordRuntimeOutput({ sessionId, path, size, mimeType })   // ONE indexing path
        • ALWAYS scope=session: FileRecordStore upsert with scope=session, owner=session,
          purpose=session_artifact, sessionKind="artifact"   ← stays under the Thread, never in developer Files
        • there is NO runtime path that writes an end-user output into the App Files Library.
   → file_id exposed in the reply; client downloads via FileStore.createDownload → GET content
```

This is the fix for §1's load-bearing bug. Run outputs are **always** session-scoped and do not appear in the App Files Library by default. Runtime output indexing has one method, eliminating double-indexing races. `sessionKind` semantics are fixed: `"attachment"` = user-supplied inbound, `"artifact"` = run-produced outbound.

### Acceptance case — the résumé thread (end-to-end)

A public résumé-editing bot. End user uploads `resume.pdf` and asks the agent to improve it.

1. Upload → Session attachment; record `owner=session, purpose=session_attachment`.
2. Agent reads the read-only copy, writes the improved résumé to a new path → `recordRuntimeOutput({…})` (always session-scoped) → `owner=session, purpose=session_artifact, sessionKind="artifact"`.
3. Reply exposes the artifact `file_id`; the end user downloads it.

**Expected App Files Library view: no new runtime output.** Both the input résumé and the output live under _that Thread_; the artifact is listed only under the session. End users are isolated from each other. Runtime outputs do not enter the App Files Library **by construction**.

### Explicit non-goals for this MVP

- No `MemoryStore`, `Memory`, `MemoryVersion`, or Dreams contract.
- No generic `resources[]` union.
- No generic `Mount` contract.
- No Claude `file_id` adapter contract.
- No end-user save-to-library flow.
- No runtime write mode into the App Files Library.

---

## 6. Migration map (current → unified)

| Current scattered surface                                                        | Unified                                                                                         |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `file-upload-create.createFileUpload`, `getFileUpload`                           | `FileStore.createUpload` / `getUpload`                                                          |
| `file-upload-transfer.*` (single-put, parts)                                     | `FileStore.putContent` / `putPart`                                                              |
| `file-upload-complete` + `file-upload-completion-steps` + `file-upload-finalize` | `FileStore.completeUpload`                                                                      |
| `file-content-service.streamFileContent`                                         | `FileStore.streamContent` / `createDownload`                                                    |
| `file-content-service.deleteFileById` + `file-scope-cleanup.deleteFilesForScope` | `FileStore.delete` / `deleteScope`                                                              |
| `file-update.updateFile`                                                         | `FileStore.update` (move gated by descriptor)                                                   |
| library listing + `session-resource-file.listSessionResources*`                  | `FileStore.list`                                                                                |
| `ensureSessionResourcesMounted`                                                  | keep as Session attachment materialization; do not replace with a generic Mount contract in MVP |
| old draft claim + public thread file glue                                        | `FileStore.claimToSession` / `ensureClaimable`                                                  |
| old runtime output indexers                                                      | `FileStore.recordRuntimeOutput` (always session-scoped artifact)                                |
| `file-record-store` + `file-record-{queries,mutations,access,model}`             | `FileRecordStore` port (private adapter)                                                        |
| `r2-s3-client` + `r2-s3-{object,multipart}-client`                               | `ObjectStore` port (private adapter)                                                            |
| old file lock service                                                            | explicit path-lock capability (used only when `descriptor.capabilities.pathLocks`)              |
| `file-paths` / `file-path.service` re-wraps of contract helpers                  | direct calls to `pkgs/contracts` helpers                                                        |

---

## 7. Staged refactor plan + one-month MVP cut

Each step is one consistent state — compiles, `just check` + `just test` green. This is a breaking pre-launch refactor: do not keep old shared-file aliases, old routes, old GraphQL fields, or Manifest compatibility.

**MVP — App-scoped Files Library and session artifact isolation only.**

1. **Rename/remove the old shared-file product surface.** Product/UI/API/GraphQL/Manifest names become Files. Remove old aliases and redirects because this has not launched.
2. **Route the HTTP/GraphQL adapters through the Files service boundary.** `file-route.ts`, Files GraphQL, `public-thread-file-api` import the Files application boundary instead of infrastructure. Delete the `file-http.service` barrel.
3. **Migrate the attachment in-path.** Collapse the three claim entry points into `claimToSession`/`ensureClaimable`; guard the R2 rollback; validate `attachmentIds` in `api-command`. Materialize inbound through the existing read-only Session file manifest.
4. **Migrate the attachment out-path + the scope fix.** Single `recordRuntimeOutput`, always `scope=session` (fixes §1's leak — no Runtime Plane write path into the App Files Library); collapse the three runtime indexing callers; fix `sessionKind` semantics. Ship the résumé-thread acceptance test.

**Deferred engineering debt (not product placeholders) — steps 5–7.**

5. **Collapse delete paths** behind `delete`/`deleteScope`; move versioning/locking invocation into `FileStore` via the registry.
6. **Collapse upload + storage adapters** into `ObjectStore`/`FileRecordStore`; make `files/infrastructure/**` private.
7. **Add the lint import-boundary rule** (§4.1–4.2) and remove old cross-module file storage dependencies.

**Exit checklist after implementation review.**

- [x] External modules call Files through the `fileStore.*` object facade, except exported types and small adapter helpers such as error normalization; no module outside `files` imports `files/infrastructure/*`.
- [x] Delete flow is one internal orchestration behind `delete` / `deleteScope`, with shared versioning, multipart abort, record marking, and R2 cleanup semantics.
- [x] Scope capability dispatch is descriptor-based before adding another scope kind; adding a scope must not require another `resolveFileUploadTargetContext` branch ladder edit.
- [x] Scope capability asymmetry is explicit policy, not incidental code shape: move/rename, versioning, and locking support must be declared per scope.
- [x] Runtime-output artifact persistence is proven by focused Files/runtime tests: runtime outputs are recorded only as session-scoped artifacts, and the old preview E2E is non-gating because that harness is not a reliable acceptance signal.

**Product naming:** the product surface is **Files** everywhere. The old shared-file scope kind does not stay. App Files Library is modeled as App-scoped uploaded files, not as an App source tree. `Memory` is not modeled in this PRD; if/when it exists, it needs its own PRD and concrete contract.

Verification per step: `just check`, `just test`, the existing file tests (`apps/api/tests/file-upload-*.test.ts`, `session-resource-files.test.ts`, `agent-package-file-import.test.ts`), and `just graphql-codegen` when GraphQL touched. In/out is validated by `file-upload-recovery.test.ts` + `session-resource-files.test.ts` + queued-run attachment validation coverage. The old preview E2E is not a release gate for this PRD.
