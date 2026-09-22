# Session Isolation and Legacy Agent Types

Status: new-admission behavior implemented for the unreleased #582 candidate; existing Cloud migration and full legacy runtime retirement remain open.

## Product contract

An Agent is reusable configuration. Each new Session owns an independent working environment and its own native conversation, files and checkpoint lineage. Continuing the same Session restores its committed state after the live runtime has been reclaimed. Another Session never receives that state, even when both use the same Agent.

Owners choose a name, harness and model. They do not select Assistant/Task or Pet/Cattle, lock that choice at publication, or fork just to change a type. Creating, importing and forking configuration cannot opt into a shared machine. Old kind inputs remain accepted for compatibility but do not select execution behavior. Draft YAML and generated calling instructions expose no type choice; package input may omit the legacy kind field.

This applies to console Preview, v1 published/live admission, v2 saved presets and direct Project invocation. v1 retains its existing publication and identity requirements. Publishing an Agent remains separate from the Session ownership rule.

All Sessions use the same durable completion boundary: the native cursor and complete
workspace checkpoint commit with the successful turn. A later failed turn cannot replace
that recovery point. Historical kind metadata cannot bypass checkpoint or output-history
readiness when admitting another turn.

Runtime maintenance targets an explicit Session. Its Project owner can restart the
Driver or recreate the Session's execution resource while retaining the public ID,
frozen configuration and committed workspace/native boundary. This also works without
an Agent preset. It never restarts a sibling Session or adopts the preset's latest
configuration. An active turn may be cancelled by an explicit maintenance request;
its historical outcome remains recorded. Archived, terminated, busy or incompletely
checkpointed Sessions cannot be silently reset. A shared or mismatched legacy binding
must cross the verified migration boundary before Session maintenance is available.

## Existing Cloud Sessions

New admission does not rewrite any existing Agent label, Session binding or shared workspace. Existing Sessions retain their admitted configuration and maintenance access until their transition is verified. Migration must preserve the same ID, native conversation and promised working files; allocating an empty isolated workspace is not migration.

The final September 22 decision allows reviewed old Sessions with no calls or file activity
for 30 days to become read-only, even if the account remains active. Preserve history and
saved files and permit a fresh direct or preset Session. All Run outcomes, file mutations
and pending work must be checked before the approved cutover; uncertain cases remain
protected. This is a one-time migration scope, not rolling expiry of formal Sessions.

The compatibility storage fields and legacy maintenance paths are transitional. #582 is not complete until all protected Cloud Sessions have a verified transition and the remaining active type-dependent behavior is retired. Final main contains one Session model and no ongoing conversion service; necessary one-time operations use a pinned release build with a defined rollback window. Keeping inert historical metadata is not a product type choice.

## Preview retention

Cloud console debugging uses one inactivity period: 30 days since message, Run or file activity. Reads and console login do not renew it. After expiry, the console starts a new Preview. Formal or API-used Sessions are protected; historical enrollment and cleanup require the reviewed inventory, recoverable backup and approved cutover.

See [Thread Continuation](./thread-continuation.md), the [Session transition contract](../session-isolation-transition.md) and the [implementation plan](../plans/2026-09-22-session-type-retirement-design.md).
