# Retire Pet/Cattle From New Execution

Status: implementation in progress; not released. The owner has selected Session-isolated execution for every Agent and removal of the active Pet/Cattle product choice. This plan applies that decision without treating legacy shared-state migration as complete.

## Product outcome

Creating, importing, or forking an Agent produces reusable configuration. It does not choose whether users share a machine. Every new Session, including console Preview and v1 public Threads, owns isolated writable state. v1 keeps its published/live configuration selection, identity requirements, and existing routes. Existing Sessions keep their admitted configuration and binding until their verified Cloud conversion; no new Session or missing-context error substitutes for that conversion.

The console no longer asks the owner to choose Assistant/Task or Pet/Cattle, locks that choice at publication, or offers a fork just to change it. The existing legacy wire fields may be accepted at compatibility adapters; they cannot select a new shared runtime. Historical labels and bindings are migration input, not a new-creation setting.

## Approach

Removing only the selector would leave imports, forks, and API callers able to create shared state. Rewriting existing records at creation time would couple a simple configuration operation to unverified customer state migration. Instead, normalize all creation paths to the one execution policy and retire the selector together, while keeping the existing migration boundary explicit.

- One Session creation path selects the isolated policy independently of a saved or live Agent's historical label. Existing source-selection behavior remains intact.
- Agent creation, package import, and fork select the same default. Legacy kind input is optional compatibility data and cannot request shared execution. Configuration updates preserve an old stored label until the approved migration changes it; they do not change existing workspace ownership.
- Remove the console's type selector, type-specific fork, comparison copy, badges and editable draft field. Keep legacy maintenance access where removing it would strand an unconverted customer workspace; it is not shown as a type selection for new work.
- Keep legacy snapshot/storage decoding and conversion checks until the actual cohort has migrated. Full #582 completion still requires deleting the remaining active runtime kind branches after that transition; this commit alone cannot establish full Type retirement.

## Verification

Exercise new Session creation through console Preview, v1 published/live selection, v2 saved preset, and direct Project invocation. In particular, a legacy Pet preset must create a new isolated Session without changing a previously admitted shared Session. Verify configuration, identity and resource ownership, not only returned labels.

Cover Agent create, import, and fork with old and omitted kind inputs. Verify edits preserve historical bindings and do not change the selected harness/model. Regenerate GraphQL from schema/documents, run relevant API/contract/web tests, workspace typecheck, generated-contract checks and v1 compatibility. Check the rendered create/editor flow after the source change.

No database migration, production data rewrite, resource cleanup, deployment, or model request is authorized by this plan. The separately prepared staging candidate remains pinned to `70bfda2a10a0410ba2ab11a7656e01ee9d04c340`; this work is developed in an isolated checkout and will join the umbrella release after its own verification.
