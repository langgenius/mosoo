# Files API — Single Abstraction Contract

Status: proposed (design contract for the Files API consolidation, YEF-674)
Scope: `apps/api/src/modules/files`, `apps/api/src/modules/spaces`, `pkgs/contracts/src/file`, `pkgs/contracts/src/space`, and every module that today reaches into file storage internals (`runtime`, `sessions`, `public-api`, `api-command`, `agents`, `agent-builder`).

This document defines the **one abstraction** all file storage flows through, the layering rules that keep it the single entry point, and the attachment in/out contract (aligned with the Claude Files API model). It is the interface contract acceptance artifact for YEF-674; the staged migration plan is in the last section.

---

## 1. Why this exists — the current state

The Files API is ~4,500 lines across ~40 files split into `application/` and `infrastructure/`. The domain model in `pkgs/contracts/src/file/file.contract.ts` is actually coherent (a scope-polymorphic `FileRecord`, a single `createFileObjectKey` projection, normalized paths). The damage is in the **service layer**, which has no facade:

- **The "application" layer is empty.** `application/file-http.service.ts` is a 50-line barrel that re-exports functions straight out of `infrastructure/*` (`file-upload-create`, `file-content-service`, `file-upload-transfer`, `space-file-update`, `space-file-lock`, …). It adds no orchestration. There is no `class`/port — services are loose functions.
- **No single entry point.** Callers must know which of ~15 infrastructure files exports the function they need. Agents use `agent-package-file.service`, sessions use `session-resource-file.service`, spaces use `space-file.service` — each re-validating access and re-doing record transforms.
- **Cross-module reach-through.** `public-api/public-thread-file-api.service.ts` imports `files/infrastructure/file-record-store` and `files/infrastructure/file-errors` directly. `runtime` imports `getParentPath`/`normalizeFileName` from `files/infrastructure`. `spaces` and `files` import each other (`ensureSpaceAccess` is called from inside the files module — a backward dependency into the `spaces` domain).
- **One logical operation, many code paths.** "Delete a file" exists three times (`file-content-service.deleteFileById`, `space-file-delete.deleteSpaceEntry`, `file-scope-cleanup.deleteFilesForScope`), each independently re-implementing multipart-abort + versioning + lock + R2 cleanup. "Write a file" is `createFileUpload` + `uploadFileContent`/parts + `completeFileUpload` across three files plus a separate draft-claim path.
- **Asymmetric features by scope.** Move/rename, versioning (`spaceFileVersionsTable`), and locking (`space-file-lock`) exist only for `space` files, even though the contract is scope-generic. `file-scope-cleanup` branches on `scope.kind === "space"`. Adding a scope kind means editing `resolveFileUploadTargetContext`'s branch ladder, not registering a descriptor.
- **Parallel storage of the same truth.** `spaceDirectoriesTable` (in `space.schema.ts`) is maintained in parallel to the path hierarchy already implied by `fileRecordsTable.path`; `space-file-list` queries and syncs both.
- **The "facades" that aren't.** `infrastructure/file-record-store.ts` and `infrastructure/r2-s3-client.ts` claim to be unified entry points but only re-export `file-record-{queries,mutations,access}` and `r2-s3-{object,multipart}-client`; callers import the underlying files directly anyway.

Engineer's verdict ("the file API is completely messed up… unsalvageable in the future") is accurate about the **service/layering** surface, not the contract types.

---

## 2. Goals / non-goals

**Goals**
1. **One abstraction** — a single `FileStore` port is the only file-storage entry point for every consumer. No module imports `files/infrastructure/*` directly.
2. **Collapse duplicate code paths** — one implementation each for write / read / list / move / delete / cleanup, parameterized by scope.
3. **Scope as data, not branches** — adding a scope kind = registering a `FileScopeDescriptor`, not editing upload/delete/cleanup ladders.
4. **One attachment in/out path** — a single claim/mount-in and a single produce/expose-out flow, modeled on the Claude Files API `file_id` reference shape.
5. **Storage and persistence behind ports** — one `ObjectStore` (R2/S3) port and one `FileRecordStore` (D1) port; locking and versioning are explicit capabilities, not scattered inline checks.

**Non-goals**
- Changing the public REST/GraphQL contract shapes in `pkgs/contracts` (they are preserved; this is internal consolidation).
- Changing R2 object-key layout or DB schema in phase 1 (key projection already lives in the contract).
- Swapping IndexedDB upload-recovery behavior on the web client.

---

## 3. The single abstraction — `FileStore`

`FileStore` is the **only** symbol consumers import. It lives at `apps/api/src/modules/files/application/file-store.ts` and is composed once from infrastructure adapters at module bootstrap. Everything else in `files/` becomes private.

```ts
// apps/api/src/modules/files/application/file-store.ts
// The ONE entry point. All consumers depend on this interface only.
export interface FileStore {
  // ── Upload lifecycle (replaces createFileUpload + transfer + complete + draft) ──
  createUpload(viewer: Viewer, req: CreateFileUploadRequest): Promise<FileUploadSummary>;
  getUpload(viewer: Viewer, fileId: FileId): Promise<FileUploadSummary>;
  putContent(viewer: Viewer, fileId: FileId, body: ContentBody): Promise<UploadFilePartResponse>;
  putPart(viewer: Viewer, fileId: FileId, partNumber: number, body: ContentBody): Promise<UploadFilePartResponse>;
  completeUpload(viewer: Viewer, fileId: FileId, req: CompleteFileUploadRequest): Promise<FileRecord>;
  abortUpload(viewer: Viewer, fileId: FileId): Promise<void>;

  // ── Records & content (replaces file-record-store + file-content-service reads) ──
  getRecord(viewer: Viewer, fileId: FileId): Promise<FileRecord>;
  streamContent(viewer: Viewer, fileId: FileId): Promise<FileContentStream>;
  createDownload(viewer: Viewer, fileId: FileId, disposition: "attachment" | "inline"): Promise<CreateFileDownloadResponse>;

  // ── Listing (replaces space-file-list + session resource list) ──
  list(viewer: Viewer, query: FileListQuery): Promise<FileListing>;

  // ── Mutation (replaces space-file-update; move/rename gated by scope capability) ──
  update(viewer: Viewer, fileId: FileId, req: UpdateFileRequest): Promise<FileRecord>;

  // ── Deletion (replaces deleteFileById + deleteSpaceEntry + deleteFilesForScope) ──
  delete(viewer: Viewer, fileId: FileId): Promise<void>;
  deleteScope(scope: FileScope): Promise<void>;

  // ── Attachment in/out (replaces draft-file-service + session-resource-file + public-thread-file-api glue) ──
  claimToSession(viewer: Viewer, sessionId: SessionId, fileIds: FileId[]): Promise<FileRecord[]>;
  ensureClaimable(viewer: Viewer, sessionId: SessionId, fileIds: FileId[]): Promise<void>;
  recordRuntimeOutput(input: RuntimeOutputFileInput): Promise<FileRecord>;
}
```

`Viewer`, `ContentBody`, `FileContentStream`, `FileListQuery`, `FileListing`, `RuntimeOutputFileInput` are defined alongside the port. All request/response DTOs (`CreateFileUploadRequest`, `FileRecord`, `FileUploadSummary`, `UpdateFileRequest`, `CreateFileDownloadResponse`, …) are **reused unchanged** from `pkgs/contracts/src/file/file.contract.ts`.

### Capabilities, not scope branches

Move/rename, versioning, and locking are **declared per scope**, never branched inline:

```ts
export interface FileScopeDescriptor {
  kind: FileScopeKind;                 // "agent_package" | "app_draft" | "session" | "space"
  defaultPurpose: FilePurpose;
  ownerKindFor(scopeId: FileScopeId): FileOwnerKind;
  supportsMove: boolean;               // space: true; others: false
  versioned: boolean;                  // space: true; others: false
  locking: "durable-object" | "none";  // space: durable-object; others: none
  resolvePath(target: CreateFileUploadTarget): string;   // replaces resolveFileUploadTargetContext branch ladder
  ensureAccess(viewer: Viewer, scopeId: FileScopeId): Promise<void>;
}

export const FILE_SCOPE_REGISTRY: Record<FileScopeKind, FileScopeDescriptor>;
```

`FileStore.update` consults `descriptor.supportsMove` and throws `file_invalid_request` for scopes that don't; `completeUpload`/`delete` consult `descriptor.versioned` and `descriptor.locking`. Adding a scope = adding one registry entry.

### Storage & persistence ports (single each)

```ts
export interface ObjectStore {           // the ONE R2/S3 surface (folds r2-s3-{object,multipart,client})
  putSingle(key: string, body: ContentBody): Promise<{ etag: string }>;
  createMultipart(key: string): Promise<MultipartHandle>;
  uploadPart(h: MultipartHandle, n: number, body: ContentBody): Promise<{ etag: string }>;
  completeMultipart(h: MultipartHandle, parts: CompleteFileUploadPart[]): Promise<{ etag: string }>;
  abortMultipart(h: MultipartHandle): Promise<void>;
  copy(from: string, to: string): Promise<{ etag: string }>;
  get(key: string): Promise<ObjectBody>;
  delete(key: string): Promise<void>;
}

export interface FileRecordStore {       // the ONE D1 surface (folds file-record-{queries,mutations,access,model})
  insertPending(rec: NewFileRecord): Promise<FileRecord>;
  markReady(fileId: FileId, etag: string, size: number): Promise<FileRecord>;
  markDeleting(fileId: FileId): Promise<void>;
  get(fileId: FileId): Promise<FileRecord | null>;
  listByScope(scope: FileScope, q: FileListQuery): Promise<FileListing>;
  transition(fileId: FileId, patch: FileRecordPatch): Promise<FileRecord>;  // owner/scope/purpose/sessionKind moves
}

export interface FileLock {              // explicit capability; descriptor decides whether it's used
  withLock<T>(scope: FileScope, path: string, fn: () => Promise<T>): Promise<T>;
}
```

`FileStore` is the only place that composes `ObjectStore` + `FileRecordStore` + `FileLock` + the scope registry. Versioning (`spaceFileVersionsTable`) is invoked by `FileStore` when `descriptor.versioned`, in exactly one place per mutating operation.

---

## 4. Layering & dependency rules

```
pkgs/contracts/src/{file,space}        ← pure types + path/key helpers (no deps)
        ▲
apps/api/.../files/application
   ├── file-store.ts        (FileStore interface + DTO re-exports)   ← consumers import ONLY this
   ├── file-scope-registry.ts
   └── ports/ {object-store, file-record-store, file-lock}.ts        (interfaces)
        ▲
apps/api/.../files/infrastructure       ← adapters that IMPLEMENT the ports (R2, D1, durable-object lock)
                                          PRIVATE: no symbol imported outside files/
```

**Enforced rules (lint boundary):**
1. No module outside `apps/api/src/modules/files/**` may import from `files/infrastructure/**`. Allowed import surface = `files/application/file-store` (+ the registry/types it re-exports).
2. `files/**` must not import from `spaces/**`. The `ensureSpaceAccess` backward-dependency is inverted: space-access becomes a `FileScopeDescriptor.ensureAccess` injected at composition, or moves into a shared `pkgs` access policy.
3. `spaces`, `runtime`, `sessions`, `public-api`, `api-command`, `agents`, `agent-builder` obtain a `FileStore` (via DI/bindings) and call methods. They never re-implement upload/claim/transform.
4. Path/key helpers stay in `pkgs/contracts` and are called by the registry/adapters — not re-wrapped per module (`runtime-space-paths` stops importing `files/infrastructure`).

A dependency-cruiser / eslint `no-restricted-imports` rule makes rule 1–2 mechanically checkable in CI.

---

## 5. Attachment in/out contract

Modeled on the Claude Files API: a file is uploaded once, gets a durable `file_id`, is **referenced** by id when entering a run, and run outputs surface as **downloadable file records** retrievable by id. (Refs: Claude Files API, Managed Agents sessions — `container_upload`/`document`/`image` blocks reference `file_id` on input; outputs return `file_id`s downloaded via `GET /v1/files/{id}/content`.)

### Inbound (request → run)
```
upload (app_draft scope, file_id issued)
   → FileStore.ensureClaimable(viewer, sessionId, fileIds)     // single validation gate
   → FileStore.claimToSession(viewer, sessionId, fileIds)      // ONE transactional claim:
        • ObjectStore.copy(draftKey → sessionKey)
        • FileRecordStore.transition(owner app→session, scope→session, purpose→session_attachment, sessionKind="attachment")
        • on failure: roll back copied destination object (today's best-effort .catch cleanup becomes a guarded step)
   → run dispatched with attachmentIds (validated at claim time, not first-touched in runtime)
   → ensureSessionResourcesMounted mounts the session attachment prefix read-only into the sandbox
```
This replaces the three independent claim entry points (`public-thread-file-api`, `public-thread-create`'s separate claimable-check + claim, `createSessionResourceUpload`) with one `FileStore.claimToSession` / `ensureClaimable` pair. `api-command` validates `attachmentIds` against `FileStore.getRecord` before queueing.

### Outbound (run → reply)
```
sandbox file mutation event
   → FileStore.recordRuntimeOutput({ sessionId, path, size, mimeType, kind: "artifact" })   // ONE indexing path
        • resolves space path
        • FileRecordStore upsert (purpose space_file / sessionKind "artifact")
   → file_id exposed in the reply; client downloads via FileStore.createDownload → GET content
```
This replaces the three event entry points that today each call `indexRuntimeSpaceFileMutation`/`syncSandboxSpaceFileMutation` (`app-access.ts`, `sandbox-file-watch.service`, `driver-instance/events.ts`) with one method, eliminating double-indexing races. `sessionKind` semantics are fixed: `"attachment"` = user-supplied inbound, `"artifact"` = run-produced outbound.

### Mapping to Claude file references (forward-looking)
When mosoo dispatches to a Claude managed agent, `FileStore` is the place that translates a mosoo `FileId` → an Anthropic `file_id` (upload-on-demand + cache the mapping) for `container_upload`/`document`/`image` input blocks, and translates output `file_id`s back into `recordRuntimeOutput`. Centralizing in/out here is what makes this integration a single adapter rather than per-call glue.

---

## 6. Migration map (current → unified)

| Current scattered surface | Unified |
|---|---|
| `file-upload-create.createFileUpload`, `getFileUpload` | `FileStore.createUpload` / `getUpload` |
| `file-upload-transfer.*` (single-put, parts) | `FileStore.putContent` / `putPart` |
| `file-upload-complete` + `file-upload-completion-steps` + `file-upload-finalize` | `FileStore.completeUpload` |
| `file-content-service.streamFileContent` | `FileStore.streamContent` / `createDownload` |
| `file-content-service.deleteFileById` + `space-file-delete.deleteSpaceEntry` + `file-scope-cleanup.deleteFilesForScope` | `FileStore.delete` / `deleteScope` |
| `space-file-update.updateSpaceFile` | `FileStore.update` (move gated by descriptor) |
| `space-file-list.*` + `session-resource-file.listSessionResources*` | `FileStore.list` |
| `draft-file-service` + `draft-file-claim.service` + `public-thread-file-api` glue | `FileStore.claimToSession` / `ensureClaimable` |
| `runtime-space-file-records.upsert*` (×3 callers) | `FileStore.recordRuntimeOutput` |
| `file-record-store` + `file-record-{queries,mutations,access,model}` | `FileRecordStore` port (private adapter) |
| `r2-s3-client` + `r2-s3-{object,multipart}-client` | `ObjectStore` port (private adapter) |
| `space-file-lock` | `FileLock` capability (used only when `descriptor.locking !== "none"`) |
| `file-paths` / `file-path.service` re-wraps of contract helpers | direct calls to `pkgs/contracts` helpers |

---

## 7. Staged refactor plan (atomic commits)

Each step is one consistent state — compiles, `just check` + `just test` green, no public-contract change. Steps are sequenced so consumers are never half-migrated.

1. **Introduce the port (additive, no behavior change).** Add `file-store.ts` (interface), `file-scope-registry.ts`, and `ports/*`. Implement `FileStore` as a thin composition that delegates to the *existing* infrastructure functions. Nothing else changes yet. ✅ verifiable in isolation.
2. **Route the HTTP/GraphQL adapters through `FileStore`.** `file-route.ts`, space GraphQL, `public-thread-file-api` import `FileStore` instead of infrastructure. Delete the `file-http.service` barrel.
3. **Migrate the attachment in-path.** Collapse the three claim entry points into `claimToSession`/`ensureClaimable`; guard the R2 rollback. Validate `attachmentIds` in `api-command`.
4. **Migrate the attachment out-path.** Single `recordRuntimeOutput`; collapse the three runtime indexing callers; fix `sessionKind` semantics.
5. **Collapse delete paths** behind `delete`/`deleteScope`; move versioning/locking invocation into `FileStore` driven by the registry.
6. **Collapse upload + storage adapters** into `ObjectStore`/`FileRecordStore`; make `files/infrastructure/**` private.
7. **Add the lint import-boundary rule** (rules §4.1–4.2) and invert the `files → spaces` dependency.
8. **(Optional, separate)** Reconcile `spaceDirectoriesTable` with the path hierarchy; add the Claude `file_id` translation adapter.

Verification per step: `just check`, `just test`, the existing file tests (`apps/api/tests/file-upload-*.test.ts`, `session-resource-files.test.ts`, `space-file-lock.test.ts`, `agent-package-file-import.test.ts`), and `just graphql-codegen` when GraphQL touched. In/out validated end-to-end by `file-upload-recovery.test.ts` + `session-resource-files.test.ts` plus a local thread attachment round-trip.
