# Session Isolation Transition

Status: unreleased #582 / #638 / #640 operating contract. The offline planner and
resumable operator executor are implementation candidates. Local native D1/R2 and
container tests cover forward conversion and rollback. Customer source recovery,
verified object preparation, hosted cutover acceptance, and release approval
remain outstanding.
This document does not authorize production writes, customer model/tool calls,
resource destruction, or notification delivery.

Follow [SPEC](./SPEC.md#10-migration-and-breaking-change-notification),
[Architecture](./architecture.md#target-session-ownership-and-cloud-transition),
and [Production Deploy Verification](./production-deploy-verification.md).
The owner requires existing continuable Sessions to retain the same public ID,
context, promised files, admitted configuration, and delegated identity. Customers
must not reconstruct state or move to a replacement conversation.

## Recovery evidence before a cutover

Maintain a private, access-controlled manifest for each affected Session. Keep
customer identifiers, native transcripts, configuration, credentials, and archive
contents out of public issues, PRs, and committed fixtures.

The manifest must bind these facts together:

- Project, Agent, original Session, delegated identity, original Sandbox binding,
  execution directory, and admission/configuration snapshot;
- the last successful Run and its completion history, later admitted work, native
  context identity, and the selected workspace's actual contents;
- source backup IDs, object metadata, archive hashes, complete file/link manifests,
  configuration provenance, and any shared-state ownership decision;
- proposed destination resources, prepared checkpoint hashes, precise forward
  changes, preconditions, before-images, and a tested rollback state.

An existing backup row, matching object metadata, or a `ready` status is not proof
of a recoverable workspace. Inspect archive contents without executing customer
files. Verify native identity, the original working directory, and the committed
turn. Check SQLite state with its WAL files where applicable, and verify that a
workspace does not contain another Session's native context.

Select the source by verified lineage, not just creation time. A September 21
read-only Cloud audit found a successful, unarchived Claude Session whose latest
ready archive was empty. An older retained archive, created after that Session's
last successful Run, contained the matching native transcript and working
directory. This establishes a candidate for further recovery verification; it
does not authorize changing production backup selection. If an older source is
used, prove that it does not discard later committed work or admitted effects.

The same audit then inspected all 43 four-kilobyte latest archives in its
53-Session metadata-qualified cohort: every inspected archive contained an empty
directory. This result applies to those recorded backup IDs, not an assumption
about all Cloud Sessions or permanent data loss. Refresh live qualification and
inspect retained history before selecting a recovery source. Metadata screening
alone cannot establish a safe migration cohort.

Inspecting all 33 retained older archives for those Sessions found 18 more empty
archives and 15 nonempty candidates created after their latest successful Runs.
Fourteen candidates matched one native context and the original directory. The
remaining candidate contained the expected parent and three native child contexts;
their recorded parent IDs, directory, and database/rollout IDs matched. Preserve
that native family rather than discarding legitimate child context. All 32
canonical user/assistant message texts were found in role order across the 15
sources. These are source candidates, not completed migrations or proof of every
tool effect and shared file. The other 28 Sessions still lack a nonempty source
among the inspected retained workspace backups; that observation does not
establish permanent data loss or justify discarding their state.

A local reproduction of the shared-subject checkpoint path found that creating a
missing conversation directory produced an empty ready archive. Repeating this
across three reclamations also pruned the earlier complete archive. The fix keeps
the existing reference when an idle, closed conversation is not resident and its
latest ready checkpoint is no older than its last message. Resident workspaces
are still checkpointed; missing required workspaces stop reclamation. Pruning
only considers directories actually checkpointed by that operation. This prevents
that replacement path; it does not prove that a retained legacy archive is valid,
recover earlier deletions, or establish the historical cause of every empty
production archive. The Cloud conversion evidence is still required.

Do not infer data loss from missing metadata or a missing entry in the current
Container list. Preserve the original resources while investigating. Missing
configuration cannot be replaced with current Agent settings merely because they
parse. An original immutable version is evidence; an update timestamp alone needs
an audit of the historical write paths.

## Prepare an isolated workspace

Preserve the Session's original directory inside the new Session-owned Sandbox.
Native runtimes can retain absolute directory references. Keeping the directory
name does not provide isolation; each Session needs its own execution resource.

Use the actual checkpoint preparation implementation in
`apps/api/src/modules/runtime/infrastructure/sandbox-backup-platform.ts` when
validating prepared copies. Do not duplicate its exclusions in a migration script
without checking them against the implementation. In particular, the current
attachment mount is `session-files`, not a guessed resource-directory name.
Exclude the current-message attachment mount and short-lived boot/provider
credentials while preserving the existing file records and stored objects.

Native Codex memory requires explicit treatment:

- New isolated Sessions keep `memories` inside their checkpointed runtime home.
  A restored real directory must not be overwritten by provisioning.
- Older workspaces can contain a link to machine-wide
  `/workspace/memory/openai-runtime/memories`. A workspace archive containing that
  link does not contain the target's files. A dangling link cannot prove emptiness.
- Inspect the corresponding shared-state source and prove ownership before
  materializing an isolated directory. Empty shared-state evidence applies only
  to the inspected machine and observation. Do not copy unassigned shared data or
  secrets into every Session.
- The startup/checkpoint guard rejects unconverted links. Convert affected old
  workspaces before deploying that guard to them. Rejection is a protective
  failure, not fulfillment of the seamless migration requirement.

Verify the prepared archive, restore it into a fresh disposable filesystem, and
compare all promised file bytes, modes, link targets, native state, and directory
identity. Test isolation between copies. Restore the selected original source
again to exercise file rollback. Synthetic canary files must be labeled as test
material, not historical customer content.

## Prepare the state transition

Changing only `kind` is insufficient. Current native-reference readers use
`committed_value` for isolated Sessions; older shared Sessions can have a valid
`value` but no committed value. A label-only change can therefore hide the native
context. The execution snapshot's binding also participates in allocation.

Prepare one consistent transition that preserves public identity and admitted
configuration while binding the Session to its own Sandbox, original directory,
verified checkpoint, and matching native commit. Do not mark the latest observed
native reference committed unless the selected workspace and successful Run
establish that boundary. Preserve history, events, artifacts, delegated identity,
runtime/model, and immutable environment/resource references. Revalidate current
credential and resource authorization when execution resumes.

Do not measure a newly introduced recovery policy retroactively from an old
success and immediately expire the migrated Session. Retain existing recovery
behavior until the reviewed transition explicitly establishes its forward policy.

The executor must reject a stale plan before changing any affected binding. The
checked state includes new input/Run admission, active runtime leases and subject
operations, changed source backup selection, native references, configuration,
ownership, archive/delete state, and the original Sandbox binding and lifecycle
state. A read-only
preflight followed by unconditional independent updates is not a concurrency gate.
Test that a conflicting admission or changed source leaves all original rows and
objects intact.

Driver provisioning must claim the current active Session, Sandbox and internal
execution-session binding in the same transaction that creates or replaces its
Driver record. Check the binding before resetting commands or grants, and await
that claim before installing files or running setup in the workspace. A pending
request captured before conversion must not recreate a Driver on the old binding.
A live provisioning record then participates in the converter's existing drain
guard; this claim does not replace physical Driver shutdown or admission control.

Late remote callbacks also cross this boundary. Conversation activation, error
recording, and close now compare the original Sandbox and execution-session ID
within their D1 writes. A callback from the old binding cannot change the replacement
or recreate a removed binding. The regression tests replace or delete the binding
during the actual remote open/close seam and verify that stale activation and its
error cleanup, as well as stale close, leave both records unchanged. This fence
does not replace the production admission/drain gate or stop an already running
Driver; the conversion executor must still verify those preconditions.

### Prepare reviewable database batches

`just session-isolation-plan <absolute input.json> <absolute new output directory>`
reads a private local manifest and writes `forward.json`, `rollback.json`,
`state.json`, and `review.json`. It performs no network, model, deployment, or D1
operation. The input must be a regular file with no group/other permissions and
at most 1 MB; the new output directory and files use modes `0700` and `0600`.
Existing output is never overwritten. Keep both input and output in ignored,
access-controlled storage.

The JSON input has these fields:

- `source`: complete raw `SELECT *` rows with database column names for `session`,
  `sandbox`, `workspace` (`sandbox_session`), `native` (`native_resume_ref`),
  `snapshot` (`session_execution_snapshot`), `run`, `sourceBackup`, `latestBackup`,
  `agent`, and `deployment` (`agent_deployment_version`). The selected source and
  latest ready backup may differ. `deployment` may be `null` only when the
  snapshot already contains its frozen `configJson`; otherwise supply the
  original immutable version referenced by the snapshot, never today's Agent
  config. Missing columns or missing original configuration stop preparation.
  Run before-images include the inert historical columns retained by the migration
  schema. The offline planner compares those columns without restoring their
  retired product behavior; an active-runtime projection is not a complete source.
- `preparedAt`: a millisecond timestamp later than the latest ready backup.
- `destination`: fresh `sandboxId`, `executionSessionId`,
  `rollbackExecutionSessionId`, `backupId`, and `rollbackBackupId`. Backup IDs use
  the repository's encoded Sandbox backup format. The rollback execution ID
  must differ from both earlier execution IDs so stale callbacks cannot become
  valid again. The public Session ID never changes.
- `workspaceEvidence`: `sessionId`, `sourceBackupId`, `completedRunId`, `cwd`,
  `runtimeId`, `nativeValue`, `sourceArchiveSha256`, `preparedArchiveSha256`, and
  `rollbackArchiveSha256`. These declare independently collected evidence; the
  planner checks their shape and correspondence but does **not** inspect archives,
  verify remote object bytes, or establish shared-memory ownership.

This initial planner supports an idle, unarchived legacy Session whose latest Run
completed successfully and whose original configuration and native source are
known. It does not qualify missing sources, active work, or other lifecycle states.
It preserves the existing recovery policy and all unrelated snapshot fields.
Completed recycling can leave an operation ID on a cold Sandbox; the planner
compares that original marker and creates the destination without it. Older
Sandbox rows can lack redundant Agent/Project/owner fields. The planner derives
the destination's ownership only when the original subject, bound Agent, Session
Project, and delegated identity agree. Conflicting non-null ownership is rejected;
the original records remain unchanged for rollback.

Both output files contain one `{ "batch": [...] }` of bound SQL statements. The
first statement checks complete before-images, successful completion history,
Agent-wide active Runs, live Drivers and conversation bindings, and current backup
selection. It also checks active Runs through every workspace and Driver attached
to each affected Sandbox, independently of Agent provenance or Driver status.
A stopped/failed Driver can still hold an active Run lease; conversion and rollback
must wait for normal reconciliation rather than marking that Run terminal to pass
the check. Rollback checks both original and isolated resources. Unrelated direct
Runs do not block the transition. These transactional checks do not establish
physical container shutdown, which still requires separate evidence.

Physical observation must not change the resource being inspected. The internal
`getContainerObservation` RPC reads `ctx.container.running` without loading the
Sandbox SDK, configuring its lifetime, contacting the container, or reading or
writing DO storage. Resolve the recorded physical namespace and normalized Sandbox
ID directly; `getSandbox` configures the SDK even when used to obtain a handle.
Absent platform state is `unavailable`, never evidence of a stopped container.
Normal operations still initialize the SDK once and restore the network policy
before access; teardown remains possible when policy restoration fails.

This timestamped observation is not a drain lease or permission to execute a
transition. A local replay on the pinned SDK reproduced a retained Session handle
starting a container after `destroy()` returned, then reporting a missing file.
The wrapper now invalidates returned Session/Process callbacks across explicit
destruction, including nested handles, delayed creation and overlapping or failed
teardown. Freshly obtained handles remain available for normal restoration.
The local container replay verifies that old Session, nested Process and listed
Process calls leave the destroyed container stopped, while fresh handles can
read/write files and execute commands; process dates and execution streams retain
their normal behavior. This verifies the wrapper on the pinned SDK, not Cloud
customer migration or a hosted release.
This guard does not drain calls or streams already in flight, intercept every
platform stop, or block later top-level SDK requests. The executor still needs to
exclude new resource access, settle previously dispatched operations, and apply
the guarded batch while that exclusion holds. Do not use repeated observations
or a wrapper RPC counter as a substitute for that barrier.

The internal Sandbox migration fence provides physical exclusion without starting
the SDK. Its caller must first atomically protect the idle Session cohort, shared
resource bindings, lifecycle operations and new Run admission in D1, and preserve
admitted file changes in their separate storage scope.
Never stop admitted customer work to make a resource eligible for conversion.
The fence is not a customer-facing migration endpoint or a production executor.

Read the recorded physical resource's fence revision, then claim it with one
operation ID and that revision. Acquisition durably flushes its marker before
resetting the Durable Object; the initial RPC therefore disconnects. A fresh stub
must confirm that the same claim survived and no longer requires a reset before
stopping the container. The reset revokes old SDK callbacks and pending JavaScript
and stream continuations; physical stop also waits for the container exit monitor
and requires an observed stopped state. A successful destroy request alone is
insufficient. While held, SDK/configuration/fetch access is rejected and alarms
cannot initialize the SDK. Read-only physical observation remains available.

Keep this fence through the guarded database transition. Release requires its
owner and revision, completed stopping, and a stopped physical container. Release
durably increments the revision, so an old claim cannot reacquire the resource;
retrying the completed release is harmless. A fence does not expire automatically.
A failed or interrupted operation must inspect the retained claim and resume its
reviewed recovery sequence. This physical primitive alone does not establish the
D1 admission barrier, checkpoint ownership or Cloud acceptance. The operator
executor below composes it with the database barrier and reviewed transition.

A local replay against the pinned SDK and product wrapper verifies persisted
fencing across actor reset, rejected old Session/Process callbacks, interrupted
synthetic execution and streaming, stopped physical state, owner-checked release
and fresh execution afterward. Replaying the old claim after release does not
reset or interrupt that fresh execution. The revision survives ordinary SDK
destruction. These are local synthetic resource checks, not evidence of customer
workspace conversion or same-public-Session native restoration.

The D1 cohort barrier reserves every existing workspace peer and every legacy
Session that could allocate on the shared Agent resource, including peers whose
Agent provenance is missing or different. Its atomic claim checks membership,
Session revisions, closed bindings, cold resource state, live Drivers and actual
Run leases. It waits for ordinary completion; it never cancels work to qualify.
The marker uses the existing operation fields and has no automatic expiry.
Activation, maintenance and delayed binding callbacks must honor that marker.
An exact claim retry is harmless; a released claim cannot reacquire an old revision.
Release rechecks closed bindings, live Drivers and actual Run leases on every
claimed resource, including destinations. A terminal Driver status cannot hide
a still-active Run; failed release leaves the whole D1 claim intact.

When Run admission races a held cohort, retain the request's original input,
configuration, IDs and idempotency key, wait for release and retry atomic admission.
Read the migration rejection cause in the same D1 transaction so a fast release
cannot turn it into a generic error. Ordinary busy-Run rejection remains unchanged;
this is a temporary migration barrier, not a queue behind an executing turn.
Archive and explicit deletion similarly wait before mutating lifecycle state;
automatic Preview cleanup skips held Sessions.

Explicit Session attachments remain in their existing object-store scope. A
workspace conversion neither moves nor deletes those records/objects, and its
checkpoint preparation excludes the current attachment mount. Uploads and file
edits may finish under the same public Session identity; preserve their current
records and renewed Preview activity. A changed complete Session before-image
invalidates the prepared database plan rather than overwriting that activity.

The offline planner accepts an optional `operationId` with matching held Session
and Sandbox before-images. The destination retains the marker through forward
and rollback batches. Release physical fences first, then atomically release the
recorded D1 cohort and destination claims. The executor below performs that
sequence; verified customer objects and hosted cutover/rollback acceptance remain
release prerequisites.

A tie in the old timestamp-only backup lookup is rejected. A stale
precondition raises a SQL error; use **one atomic D1 batch**, never separate calls
for its statements. A failure after destination insertion must roll back the
whole batch. Repeated application fails without replacing the winning state.

Forward preparation retains original backup rows and attaches a separate verified
checkpoint to the Session-owned Sandbox. Rollback keeps those resources and adds
a verified original-layout checkpoint newer than the known latest backup, so the
actual old reader can restore it. The recorded before-image alone is not the
rollback destination. The rollback guard rejects newly admitted work or changed
source/destination resources; it cannot undo later model/tool effects.

Before execution, verify the exact target account/database, source and destination
object hashes and restore behavior, original configuration, drained Drivers, and
reviewed batch hashes. Attach those facts to the approval packet. `review.json`
records input and batch hashes, statement counts, and zero remote actions; it is
neither a production target authorization nor proof that those external checks
passed. No production execution command is supplied by this planner.

### Execute and resume a reviewed operation

The separate operator executor converts one qualified Session while holding its
entire shared-source cohort. It uses the existing `api_command` table for an
operator-owned `session_isolation` record. The ordinary command queue cannot
execute it. Its reviewed input and phase are durable; its ownership does not
expire. Each step compares the previous receipt in the same native D1 batch as
its database changes. A lost response is resolved by inspecting and resuming the
same operation ID, never by clearing claims or guessing from live Session rows.

Prepare a private JSON request containing:

- `operationId`: a fresh platform ID, retained for every retry;
- `cohort`: the original Sandbox identity, binding, lifecycle revision and update
  timestamp, plus every member's Session ID, lifecycle revision and archive state,
  as returned by `readSessionIsolationCohort`;
- `plan`: the original, unheld input to the offline planner, including all reviewed
  before-images and source/prepared/rollback archive hashes;
- `metadataHashes`: SHA-256 values named `source`, `prepared` and `rollback` for
  those archives' actual `meta.json` objects.

Preparation verifies the actual object bytes and rejects changed, missing,
misidentified or expired metadata. Metadata must describe the reviewed directory
and archive size. A source must remain usable through the verification safety
buffer; its SDK creation time may precede the later D1 record timestamp. Prepared
and rollback copies must cover at least their full database-promised lifetime.
This is an identity/integrity check, not a replacement for inspecting the archive
contents and proving recovery before approving a customer cohort.

The phases are `prepared` → `held` → `converted` → `releasing` → `complete`.
Claiming the full source cohort and reserving the fresh destination row is atomic.
The next step acquires both recorded physical fence revisions, resets stale actors,
stops both containers, rechecks the objects and applies the guarded conversion.
Release re-establishes a stopped observation after an actor restart, releases both
physical fences, then atomically releases database admission and saves completion.
A completed operation only returns its receipt; retrying it cannot stop newly
admitted work or reacquire an old fence revision.

Rollback records its direction before applying the inverse and passes through
`restored` before release. It preserves current attachment activity, titles and
Agent edits while checking all execution fields and restoring the reviewed frozen
configuration and native context. Before any conversion, abort removes only its
own unused destination reservation. After conversion it retains copied resources
and backups. Rollback revalidates its original-layout copy; an unusable forward
archive cannot prevent recovery from that verified copy. Rollback selection closes
when phase `releasing` begins; later work
needs a new reviewed transition, not reuse of an old inverse.

`SessionIsolationAdmin` is a named Worker service entrypoint with no HTTP route.
An account-owned operator config must explicitly bind `SESSION_ISOLATION` to that
entrypoint on the reviewed API Worker. A hosted binding uses the selected account
and service with `remote = true`; a local fixture uses its local service instead.
This service binding is the control path; a local proxy must not simulate remote
Durable Objects or Containers, which do not support remote bindings.

```toml
name = "mosoo-session-isolation-operator"
account_id = "<reviewed account ID>"
compatibility_date = "2026-08-01"
compatibility_flags = ["nodejs_compat"]

[[services]]
binding = "SESSION_ISOLATION"
service = "<reviewed API Worker name>"
entrypoint = "SessionIsolationAdmin"
remote = true
```

Run `just session-isolation-run <absolute operator config> <mode> <input> <absolute
new receipt directory>`. `prepare` takes the private request path; `inspect`,
`advance`, `run` and `rollback` take the existing operation ID. `advance` performs
one durable step; `run` resumes through completion; `rollback` records the inverse
direction and resumes it. Each invocation needs a new receipt directory. The CLI
saves private `receipt.json` or `failure.json` with directory/file modes `0700` and
`0600`; it makes no model request. Failed operations are not retried by a background
scheduler. The operator must inspect and resume them, retaining admission
protection until the recorded recovery sequence completes.

Local verification combines all 18 D1 migrations, actual R2 archives, the named
service entrypoint, the actual operator CLI and real containers. It covers lost conversion acknowledgement,
actor restart before release, same-ID workspace restoration, rollback, expired
metadata rejection and harmless completion replay. The native-context marker in
this fixture is synthetic; it proves preserved references and file bytes, not a
customer harness turn or hosted acceptance. Production use still requires the
reviewed target/cohort, source recovery, backup/rollback plan and explicit approval.

## Rollback and release

Before accepting new work on a converted Session, prove both data restoration and
the runtime's actual lookup behavior after rollback. Exact restoration of database
before-images is necessary evidence, but is insufficient if the original lookup
would select a known-empty or invalid backup. Establish a verified functional
rollback source before approving that cohort; do not silently classify an empty
backup as valid just to reproduce the old rows.

Retain old resources, source archives, manifests, and before-images through the
approved rollback period. Once new model/tool work is admitted, preserve its new
state and reconcile external side effects before reverting. A Worker rollback or
an old file copy cannot undo those effects.

The September 21 local rehearsals establish archive/native correspondence and
file/database reversibility on selected copies. They do not prove a production
admission barrier, all-customer coverage, live migrated continuation, or an
authorized rollout. Real tool acceptance belongs in authorized isolated fixtures;
customer tool/model execution requires its own authorization and effect review.

For each proposed production cohort, present the affected Sessions, customer
experience, verified recovery and rollback sources, admission/drain sequence,
release order, notice draft, observation criteria, and stopping conditions. Obtain
the required production approval only after these are concrete. Preserve existing
Thread routes and IDs where compatible; naming alone does not require an endpoint
sunset. Finish active Pet/Cattle removal and compatible API/Driver/CLI/docs release
before closing #582. Platform supply, recharge, and commercial billing stay in
independent #636 scope.

## Cloud debug Preview retirement

The owner-approved exception is a single 30-day inactivity period for Cloud debug
Previews; it does not change formal/API-invoked continuation. New console Previews
record `previewRetentionMs` in their execution snapshot. Last message/Run activity
and an explicit file-mutation clock in Session metadata determine inactivity;
general `updated_at` maintenance timestamps do not. A selected Preview is checked
by ID, not inferred missing from a paginated list. Cleanup rechecks policy, API
provenance, active Runs, uploads, and lifecycle ownership when claiming the existing
terminal cleanup operation.

Historical Sessions have no new deadline by default. Before enrolling or retiring
any of them, produce the exact ID list and activity evidence, distinguish console
debugging from API use, and back up their D1 rows, files, checkpoints, and shared
resource mapping. Verify restoration in isolation and obtain approval for that
cohort. Enroll only intact original snapshots; never fabricate missing execution
configuration merely to make a policy marker fit. An expired historical Preview
without an intact snapshot needs an explicitly reviewed retirement operation.
Data deletion is irreversible without those backups; a Worker rollback cannot
undo an already admitted cleanup. Do not release a shared Agent machine or its
unassigned archives just because one Preview was removed.
