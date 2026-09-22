# Retire Pet/Cattle From Session Execution

Status: implementation in progress; not released. The owner selected one Session execution model and removal of active Pet/Cattle fields and branches. New admission is already isolated; full runtime retirement and Cloud conversion remain open. The final September 22 scope qualifies the one-time old-Session exception by its own 30-day call/file activity, even when its owner remains active. This does not authorize a deployment or historical data rewrite.

## Product outcome

Creating, importing, or forking an Agent produces reusable configuration. It does not choose whether users share a machine. Every new Session, including console Preview and v1 public Threads, owns isolated writable state. v1 keeps its published/live configuration selection, identity requirements, and existing routes. Existing Sessions keep their admitted configuration and binding until their verified Cloud conversion; no new Session or missing-context error substitutes for that conversion.

The console no longer asks the owner to choose Assistant/Task or Pet/Cattle, locks that choice at publication, or offers a fork just to change it. The existing legacy wire fields may be accepted at compatibility adapters; they cannot select a new shared runtime. Historical labels and bindings are migration input, not a new-creation setting.

## Approach

Removing only the selector would leave imports, forks, and API callers able to create shared state. Rewriting existing records at creation time would couple a simple configuration operation to unverified customer state migration. Instead, normalize all creation paths to the one execution policy and retire the selector together, while keeping the existing migration boundary explicit.

- One Session creation path selects the isolated policy independently of a saved or live Agent's historical label. Existing source-selection behavior remains intact.
- Agent creation, package import, and fork select the same default. Legacy kind input is optional compatibility data and cannot request shared execution. Configuration updates preserve an old stored label until the approved migration changes it; they do not change existing workspace ownership.
- Remove the console's type selector, type-specific fork, comparison copy, badges and editable draft field. Keep legacy maintenance access where removing it would strand an unconverted customer workspace; it is not shown as a type selection for new work.
- Keep legacy snapshot/storage decoding and conversion checks until the actual cohort has migrated. Full #582 completion still requires deleting the remaining active runtime kind branches after that transition; this commit alone cannot establish full Type retirement.

Continuation has one commit boundary: a successful turn records its native cursor and
workspace checkpoint together. Recovery reads that committed cursor, never a newer
observation from a failed or interrupted turn. Admission waits for that checkpoint and
the completed output projection for every Session, independently of historical kind
metadata. The pinned Cloud conversion must establish this boundary for protected old
Sessions before the final candidate is deployed; a missing cursor is not an acceptable
substitute for their promised migration.

## Verification

Keep the already verified conversion code and its matching Driver at pinned commit
`9bff2a7c11aa6bb8e721df43073f2322ff27d560` as finite release material. The final
candidate removes the executor, planner, operator entrypoint and operator CLI commands;
retain existing guards during the remaining runtime retirement. Before final cutover,
all approved inactive Sessions must be read-only, protected Sessions must have verified
isolated continuation, and no conversion claim or physical fence may remain pending.
Then retire the transitional guards together with active dual-type behavior. Preserve
normal permissions, concurrency, stale-binding and durability checks.

Exercise new Session creation through console Preview, v1 published/live selection, v2 saved preset, and direct Project invocation. In particular, a legacy Pet preset must create a new isolated Session without changing a previously admitted shared Session. Verify configuration, identity and resource ownership, not only returned labels.

Cover Agent create, import, and fork with old and omitted kind inputs. Verify edits preserve historical bindings and do not change the selected harness/model. Regenerate GraphQL from schema/documents, run relevant API/contract/web tests, workspace typecheck, generated-contract checks and v1 compatibility. Check the rendered create/editor flow after the source change.

No database migration, production data rewrite, resource cleanup, deployment, or model request is authorized by this plan. This work is developed in an isolated checkout from `9bff2a7c11aa6bb8e721df43073f2322ff27d560`; earlier source-specific staging proposals do not authorize this candidate. Final API/Driver/CLI/docs pins and hosted acceptance must follow the completed source.
