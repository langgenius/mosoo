# Session Isolation Transition

Status: unreleased #582 / #638 / #640 operating contract. The production
migration executor, concurrency gate, and release approval are still required.
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
