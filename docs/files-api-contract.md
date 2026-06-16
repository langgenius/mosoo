# Files API — Single Abstraction Contract

Status: proposed (design contract for the Files API consolidation, YEF-674)
Scope: `apps/api/src/modules/files`, `apps/api/src/modules/spaces`, `pkgs/contracts/src/file`, `pkgs/contracts/src/space`, and every module that today reaches into file storage internals (`runtime`, `sessions`, `public-api`, `api-command`, `agents`, `agent-builder`).

This document defines the **one abstraction** all file storage flows through (`FileStore`), the **product model** that sits on top of it (Files, Mounts, the two write doors, and the scope axis), the layering rules that keep it the single entry point, and the attachment in/out contract (aligned with the Claude Managed Agents `file_id` / `resources[]` model). It is the interface contract acceptance artifact for YEF-674; the staged migration plan and the one-month MVP cut are at the end.

---

## 1. Why this exists — the current state

The Files API is ~4,500 lines across ~40 files split into `application/` and `infrastructure/`. The domain model in `pkgs/contracts/src/file/file.contract.ts` is actually coherent (a scope-polymorphic `FileRecord`, a single `createFileObjectKey` projection, normalized paths). The damage is in the **service layer**, which has no facade:

- **The "application" layer is empty.** `application/file-http.service.ts` is a 50-line barrel that re-exports functions straight out of `infrastructure/*` (`file-upload-create`, `file-content-service`, `file-upload-transfer`, `space-file-update`, `space-file-lock`, …). It adds no orchestration. There is no `class`/port — services are loose functions.
- **No single entry point.** Callers must know which of ~15 infrastructure files exports the function they need. Agents use `agent-package-file.service`, sessions use `session-resource-file.service`, spaces use `space-file.service` — each re-validating access and re-doing record transforms.
- **Cross-module reach-through.** `public-api/public-thread-file-api.service.ts` imports `files/infrastructure/file-record-store` and `files/infrastructure/file-errors` directly. `runtime` imports `getParentPath`/`normalizeFileName` from `files/infrastructure`. `spaces` and `files` import each other (`ensureSpaceAccess` is called from inside the files module — a backward dependency into the `spaces` domain).
- **One logical operation, many code paths.** "Delete a file" exists three times (`file-content-service.deleteFileById`, `space-file-delete.deleteSpaceEntry`, `file-scope-cleanup.deleteFilesForScope`), each independently re-implementing multipart-abort + versioning + lock + R2 cleanup. "Write a file" is `createFileUpload` + `uploadFileContent`/parts + `completeFileUpload` across three files plus a separate draft-claim path.
- **Asymmetric features by scope.** Move/rename, versioning (`spaceFileVersionsTable`), and locking (`space-file-lock`) exist only for `space` files, even though the contract is scope-generic. `file-scope-cleanup` branches on `scope.kind === "space"`. Adding a scope kind means editing `resolveFileUploadTargetContext`'s branch ladder, not registering a descriptor.
- **The end-user/developer boundary leaks (the load-bearing bug).** Run outputs are written by `runtime-space-file-records.upsertRuntimeSpaceFileRecord` as **space** files: `scopeKind:"space"`, `ownerKind:"space"`, `purpose:"space_file"`, `sessionKind:null`. The session view merely *labels* them `kind:"artifact"`. So an end user's run output lands in the App's **persistent, developer-visible** Files. In a multi-end-user app (e.g. a public résumé bot) every end user's output piles into the developer's one shared tree — a multi-tenant / privacy leak. This is design-level, not a typo: the code has **no way to express** "an end user's one-off output must not enter the developer's drive."
- **Parallel storage of the same truth.** `spaceDirectoriesTable` (in `space.schema.ts`) is maintained in parallel to the path hierarchy already implied by `fileRecordsTable.path`; `space-file-list` queries and syncs both.
- **The "facades" that aren't.** `infrastructure/file-record-store.ts` and `infrastructure/r2-s3-client.ts` claim to be unified entry points but only re-export `file-record-{queries,mutations,access}` and `r2-s3-{object,multipart}-client`; callers import the underlying files directly anyway.

Engineer's verdict ("the file API is completely messed up… unsalvageable in the future") is accurate about the **service/layering** surface and the **scope leak**, not the contract types.

---

## 2. Product model: Files, Mounts, and the two write doors

The product surface is **two primitives, not three nouns**. "Space", "Memory", "knowledge base", and "session attachment" are not separate entities — they are *configurations* of these two.

### 2.1 Files — the App's single persistent tree
An App has **one** durable, versioned file tree: **Files** (product name; the code may keep the `space` scope kind — SPEC already says "existing code may still use the name Space"). It is the developer's network-drive: curated, App-owned, mountable into agents at a fine grain (each agent mounts the subtrees it needs). We drop the plural "Spaces" entity — one App needs one tree, sub-volumes are just directories.

### 2.2 Mount — how anything enters an agent sandbox
A **Mount** is the unit of configuration that binds a source into an agent's sandbox:

```
Mount = {
  source:        Files-subtree | uploaded-file | session-area,
  mount_path:    string,                    // absolute path in the sandbox
  runtime_access: "ro" | "rw",              // can the AGENT write here during a run?
  scope:         "shared" | "session" | "user",  // is the writable target one shared tree, or isolated per session / per end-user?
}
```

Everything reduces to a Mount:
- **Knowledge base** = `Mount(Files subtree, ro, shared)` — the KB bot.
- **Agent memory / scratch** = `Mount(subtree, rw, session)` (or `user`).
- **Session attachment** = `Mount(uploaded file, ro, session)` — the degenerate case.

### 2.3 The two write doors (never conflate them)
`runtime_access` governs **only** the agent at runtime. Curation is a **different door**:

| Door | Who | Channel | Governs |
|---|---|---|---|
| **Developer door** | App owner | management API / console (out of band) | curating Files (KB, templates, config). Always open to the owner, independent of `runtime_access`. |
| **Agent-runtime door** | the agent in a session (possibly driven by untrusted end-user input) | sandbox writes during a run | bounded by the Mount's `runtime_access` + `scope`. |

A public KB/résumé bot mounts its KB as `(ro, shared)`: the developer writes it through the developer door; **every end-user session is read-only** through the runtime door. Prompt-injected end-user input can at most write its own `(rw, session|user)` area, never the shared KB. This is exactly Claude's "shared read-only store + per-user read-write store" guidance, expressed as two Mount fields instead of two resource types.

### 2.4 What curated persistent Files is *for* — across the developer's product lifecycle

Curated Files is the **developer's durable control surface over what the agent KNOWS and WORKS WITH** — the half of the file world that is the developer's IP, as opposed to session files, which are the end-user's transient data. Its value compounds across the App's whole life:

1. **Build — ground the agent.** Seed product docs, FAQ, policies, house-style templates, few-shot examples, output schemas, scoring rubrics. This is the agent's world-knowledge *and* its working materials. (KB bot: the FAQ corpus. Résumé bot: the résumé templates, ATS keyword lists, and scoring rubric that *every* end-user run is edited against — without curated Files, each session starts from zero and the output is generic.)
2. **Ship — consistency across all sessions and all end users.** Because it is shared + read-only at runtime + versioned, every end-user session reasons over the *same* ground truth at a *known* version. One brain, centrally controlled; answers don't drift between users.
3. **Operate — correct without a redeploy.** Wrong answer in production? Edit the file through the developer door; the next session is fixed. No code deploy, no re-embedding, no model change. The out-of-band developer write door **is** the product's iteration loop.
4. **Trust / audit — versioned knowledge.** Each curation is a version (we already have `spaceFileVersionsTable`). You can see what the agent knew at any point, roll back a bad edit, and prove provenance — load-bearing for support, finance, and compliance bots.
5. **Scale across an App's agents.** SPEC allows Storage to be bound by one or more Agents. A "writer" agent and a "reviewer" agent both mount the same brand-guidelines subtree. Curated Files is the **shared substrate of the App**, not a per-agent silo.
6. **Optional durable landing zone (opt-in only).** When the developer *genuinely wants* to accumulate end-user outputs — a recruiting app retaining every submitted résumé, a research agent building a shared corpus — they explicitly add a `Mount(Files subtree, rw, shared)` output target. Rare, deliberate, never the default. (Contrast: §1's bug makes this the *accidental* default today.)
7. **Export / portability.** SPEC exports an App to one `Skill.md`. Curated Files is the portable knowledge/asset bundle that travels with the App — a large part of what makes an App forkable and reusable.

The through-line: **session files are the user's data; curated Files is the developer's product.** Keeping them on opposite sides of the `scope` axis is what makes the résumé bot safe *and* makes this control surface coherent. Delete curated Files and you delete the developer's ability to ground, standardize, correct, audit, and ship an agent product without redeploying it.

---

## 3. The single abstraction — `FileStore`

`FileStore` is the **only** symbol consumers import. It lives at `apps/api/src/modules/files/application/file-store.ts`, composed once from infrastructure adapters at module bootstrap. Everything else in `files/` becomes private.

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

  // ── Mounts (declarative; replaces ensureSessionResourcesMounted + ad-hoc space mounts) ──
  resolveMounts(viewer: Viewer, sessionId: SessionId): Promise<Mount[]>;   // {source, mount_path, runtime_access, scope}

  // ── Attachment in/out (replaces draft-file-service + session-resource-file + public-thread-file-api glue) ──
  claimToSession(viewer: Viewer, sessionId: SessionId, fileIds: FileId[]): Promise<FileRecord[]>;
  ensureClaimable(viewer: Viewer, sessionId: SessionId, fileIds: FileId[]): Promise<void>;
  recordRuntimeOutput(input: RuntimeOutputFileInput): Promise<FileRecord>;  // input carries the originating Mount's scope
}
```

All request/response DTOs (`CreateFileUploadRequest`, `FileRecord`, `FileUploadSummary`, `UpdateFileRequest`, `CreateFileDownloadResponse`, …) are **reused unchanged** from `pkgs/contracts/src/file/file.contract.ts`. `Mount` adds `{ source, mount_path, runtime_access, scope }` to the contract.

### Capabilities, not scope branches

Move/rename, versioning, and locking are **declared per scope**, never branched inline:

```ts
export interface FileScopeDescriptor {
  kind: FileScopeKind;                 // "agent_package" | "app_draft" | "session" | "space"(Files)
  defaultPurpose: FilePurpose;
  ownerKindFor(scopeId: FileScopeId): FileOwnerKind;
  supportsMove: boolean;               // Files: true; others: false
  versioned: boolean;                  // Files: true; others: false
  locking: "durable-object" | "none";  // Files: durable-object; others: none
  resolvePath(target: CreateFileUploadTarget): string;
  ensureAccess(viewer: Viewer, scopeId: FileScopeId): Promise<void>;
}

export const FILE_SCOPE_REGISTRY: Record<FileScopeKind, FileScopeDescriptor>;
```

`FileStore.update` consults `descriptor.supportsMove`; `completeUpload`/`delete` consult `descriptor.versioned` and `descriptor.locking`. Adding a scope = adding one registry entry.

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

A dependency-cruiser / eslint `no-restricted-imports` rule makes rules 1–2 mechanically checkable in CI.

---

## 5. Attachment in/out contract

Modeled on the Claude Managed Agents model: a file is uploaded once, gets a durable `file_id`, is **referenced** by id (a `resources[]` mount or a `container_upload`/`document`/`image` block) when entering a run, and run outputs surface as **downloadable file records** retrievable via `GET /v1/files/{id}/content`.

### Inbound (request → run) — the end-user journey
```
upload (app_draft scope, file_id issued)
   → FileStore.ensureClaimable(viewer, sessionId, fileIds)     // single validation gate
   → FileStore.claimToSession(viewer, sessionId, fileIds)      // ONE transactional claim:
        • ObjectStore.copy(draftKey → sessionKey)
        • FileRecordStore.transition(owner app→session, scope→session, purpose→session_attachment, sessionKind="attachment")
        • on failure: roll back the copied destination object (today's best-effort .catch becomes a guarded step)
   → run dispatched with attachmentIds (validated at claim time, not first-touched in runtime)
   → Mount(uploaded file, ro, session) materialized into the sandbox
```
Replaces the three independent claim entry points (`public-thread-file-api`, `public-thread-create`'s separate claimable-check + claim, `createSessionResourceUpload`) with one `claimToSession` / `ensureClaimable` pair. `api-command` validates `attachmentIds` against `FileStore.getRecord` before queueing.

### Outbound (run → reply) — default `scope=session`, NOT space
```
sandbox file mutation event
   → FileStore.recordRuntimeOutput({ sessionId, mountScope, path, size, mimeType })   // ONE indexing path
        • DEFAULT mountScope = "session": FileRecordStore upsert with scope=session, owner=session,
          purpose=session_artifact, sessionKind="artifact"   ← stays under the Thread, NOT in developer Files
        • mountScope = "shared" ONLY when the developer configured a Mount(Files subtree, rw, shared):
          upsert scope=space, purpose=space_file            ← opt-in persistence into curated Files
   → file_id exposed in the reply; client downloads via FileStore.createDownload → GET content
```
This is the fix for §1's load-bearing bug. Run outputs default to the session and are invisible in the developer's Files; they land in curated Files **only** through an explicit developer-configured `(rw, shared)` output Mount. Also collapses the three event entry points that today each call `indexRuntimeSpaceFileMutation`/`syncSandboxSpaceFileMutation` (`app-access.ts`, `sandbox-file-watch.service`, `driver-instance/events.ts`) into one method, eliminating double-indexing races. `sessionKind` semantics are fixed: `"attachment"` = user-supplied inbound, `"artifact"` = run-produced outbound.

### Acceptance case — the résumé thread (end-to-end)
A public résumé-editing bot. End user uploads `resume.pdf` and asks the agent to improve it.

1. Upload → `Mount(uploaded resume, ro, session)`; record `owner=session, purpose=session_attachment`.
2. Agent reads the read-only copy, writes the improved résumé to a new path → `recordRuntimeOutput({mountScope:"session", …})` → `owner=session, purpose=session_artifact, sessionKind="artifact"`.
3. Reply exposes the artifact `file_id`; the end user downloads it.

**Expected developer "Files" view: no change.** Both the input résumé and the output live under *that Thread*; neither enters the App's curated Files. End users are isolated from each other. Files changes *only* if the developer added a `Mount(Files subtree, rw, shared)` landing zone (e.g. a recruiting app retaining submissions). Acceptance test asserts: after the run, `FileStore.list` over App Files scope is unchanged; the artifact is listed only under the session.

### Mapping to Claude file references (forward-looking)
When mosoo dispatches to a Claude managed agent, `FileStore` is the single place that translates a mosoo `FileId` → an Anthropic `file_id` (upload-on-demand + cache the mapping). Mount → Claude session resource is a near-identity map: `(ro, shared)` Files subtree → `read_only` memory_store / file resource; `(rw, session|user)` → `read_write` memory_store; uploaded attachment → `{type:"file", file_id, mount_path}`. Centralizing in/out here makes this a single thin adapter rather than per-call glue.

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
| `ensureSessionResourcesMounted` + ad-hoc space mounts | `FileStore.resolveMounts` (declarative `Mount[]`) |
| `draft-file-service` + `draft-file-claim.service` + `public-thread-file-api` glue | `FileStore.claimToSession` / `ensureClaimable` |
| `runtime-space-file-records.upsert*` (×3 callers, hardcoded space scope) | `FileStore.recordRuntimeOutput` (scope from Mount, default session) |
| `file-record-store` + `file-record-{queries,mutations,access,model}` | `FileRecordStore` port (private adapter) |
| `r2-s3-client` + `r2-s3-{object,multipart}-client` | `ObjectStore` port (private adapter) |
| `space-file-lock` | `FileLock` capability (used only when `descriptor.locking !== "none"`) |
| `file-paths` / `file-path.service` re-wraps of contract helpers | direct calls to `pkgs/contracts` helpers |

---

## 7. Staged refactor plan + one-month MVP cut

Each step is one consistent state — compiles, `just check` + `just test` green, no public-contract change. Steps are sequenced so consumers are never half-migrated.

**MVP (the one month, 3-person team) — steps 1–4. This is the whole "not outdated" bet: single in/out + the `resources[]`/Mount model + the scope fix.**

1. **Introduce the port (additive, no behavior change).** Add `file-store.ts`, `file-scope-registry.ts`, `ports/*`. Implement `FileStore` as a thin composition delegating to existing infrastructure. ✅ verifiable in isolation.
2. **Route the HTTP/GraphQL adapters through `FileStore`.** `file-route.ts`, space GraphQL, `public-thread-file-api` import `FileStore` instead of infrastructure. Delete the `file-http.service` barrel.
3. **Migrate the attachment in-path.** Collapse the three claim entry points into `claimToSession`/`ensureClaimable`; guard the R2 rollback; validate `attachmentIds` in `api-command`. Materialize inbound as `Mount(upload, ro, session)`.
4. **Migrate the attachment out-path + the scope fix.** Single `recordRuntimeOutput` with `mountScope` defaulting to `session` (fixes §1's leak); collapse the three runtime indexing callers; fix `sessionKind` semantics. Add the `Mount` shape (`{source, mount_path, runtime_access, scope}`) to the session resource list. Ship the résumé-thread acceptance test.

**Deferred debt (not required for MVP) — steps 5–8.**

5. **Collapse delete paths** behind `delete`/`deleteScope`; move versioning/locking invocation into `FileStore` via the registry.
6. **Collapse upload + storage adapters** into `ObjectStore`/`FileRecordStore`; make `files/infrastructure/**` private.
7. **Add the lint import-boundary rule** (§4.1–4.2) and invert the `files → spaces` dependency.
8. **(Optional, separate)** Reconcile `spaceDirectoriesTable` with the path hierarchy; add the `user` scope value (needs end-user identity); add the Claude `file_id` translation adapter.

**Product naming:** Space → **Files** (singular App tree) at the product/UI layer; the internal `space` scope kind can stay. `Memory` is **not** a new resource — read-write agent memory is `Mount(Files subtree, rw, session|user)`. `user` scope is reserved as a third enum value (step 8), so adding cross-session per-end-user memory later is additive, not a rebuild.

Verification per step: `just check`, `just test`, the existing file tests (`apps/api/tests/file-upload-*.test.ts`, `session-resource-files.test.ts`, `space-file-lock.test.ts`, `agent-package-file-import.test.ts`), and `just graphql-codegen` when GraphQL touched. In/out validated end-to-end by `file-upload-recovery.test.ts` + `session-resource-files.test.ts` + the new résumé-thread acceptance test (asserts App Files unchanged after an end-user run).
