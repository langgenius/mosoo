# Managed Agent v1: Remaining Execution Slices

Status: target scope from the September 10, 2026 product review, with the owner-approved BYOK release boundary on September 19 seamless Cloud continuation reaffirmed on September 21, and direct invocation prioritized on September 22. Single-turn tasks and multi-turn continuation share the same durable Session contract. [SPEC](../SPEC.md) is the target contract; the remaining slices require implementation and release evidence.

## #546 — API-First Managed Agent Runtime

An application supplies a Project key, harness/model, instructions, input, and optional files. A saved private Agent is an optional preset. Mosoo owns execution, sandboxing, durable continuation, events, artifacts, usage, and cleanup. The application keeps its business logic, end-user identity, queue, validation, storage, and UI. The #582 release invokes Codex and Claude Code directly using model credentials configured in the Project, without first creating or publishing an Agent. Platform-supplied model credentials remain separate #636 work.

Both ghFind's single-turn evaluation and CSV analysis with follow-up are required acceptance paths. A single-turn integration does not restrict Session continuation. The parent and child issue descriptions follow this mapping, including removal of public historical-version selection and interactive approvals and deferral of typed Git infrastructure.

## Completed Prerequisites

#579 (Channels), #580 (App Deployment / bound capabilities), and #581 (Project keys and separate CLI login) are closed. Do not restore removed product surfaces because inert historical storage remains.

## #581 — Project And Keys: Shipped

Project is the shipped resource boundary: one account owns multiple Projects and each Project has multiple keys. Project settings provide key creation/revocation, with cross-Project denial for Agent configuration, execution, and files. Account control-plane and cross-Project access use console or CLI login with a distinct account credential. The completed cutover rejects old account tokens and requires CLI re-login; it does not assign existing keys to a default Project. Resources and history were preserved and the compatible CLI was released. Cloudflare accepted 153 user notices with sample inbox verification; see [#581 release evidence](https://github.com/langgenius/mosoo/issues/581#issuecomment-5582765337).

## #582 — Durable Sessions With Project Model Credentials

Deliver one public Session handle for direct harness/model invocation and optional saved private presets, with Project-owned model credentials (BYOK). Reuse runtime, files, events, usage and checkpoints. Remove Pet/Cattle without removing native continuation. Platform model supply, recharge, and commercial billing are not #582 acceptance or closure requirements.

The existing Thread API and conversation IDs can provide that handle. Preserve compatible names, routes, fields, and retries; #582 does not require cosmetic API replacement or an old-endpoint sunset. Run details may remain visible without being required for callers to continue or cancel work.

Session isolation replaces shared writable Agent machines. Before changing existing Cloud workloads, inventory shared state and admitted work and verify each Session's recovery lineage. Migration must preserve the original conversation ID, context, promised working files, admitted configuration, history, artifacts, and delegated identity without customer recovery steps. The owner explicitly requires the same continuation experience for a reply within one minute and a reply seven days later. A replacement Session with selected files or a summary is not an accepted migration fallback. Unverified recovery blocks the affected cutover and #582 closure while its existing mapping and resources are retained. An inert historical type column may remain; changing labels or starting empty workspaces is not a migration.

The September 22 exception is Cloud debug Preview retention: one 30-day inactivity period, followed by cleanup and a new Preview on return. Formal/API-invoked Sessions retain the migration guarantee, including legacy Preview labels. New Previews explicitly record the policy; historical enrollment/cleanup requires a reviewed inventory including file activity, backups, and production approval. See [Thread Lifecycle](./session-lifecycle.md#cloud-debug-preview-retention-unreleased). This does not declare historical recovery gaps resolved merely because a Preview appears old.

Require both acceptance paths without pre-creating an Agent. Verify the same public contract across Codex and Claude Code, unsupported-combination rejection, Project isolation, creation idempotency, and effective-configuration freezing. Retain saved-Agent compatibility separately; its earlier acceptance is not evidence that the new direct path works.

Require both acceptance paths:

- **ghFind:** one evaluation input and fixed-commit repository material produce validated analysis JSON, evidence JSON, and a Markdown report through one Session. Repeated idempotent creation does not duplicate work. History and saved artifacts remain readable after runtime reclamation, without requiring a follow-up turn. The Agent may fetch a public repository at an exact commit using existing tools; caller-prepared file input is optional. Record and validate the actual material identity across retries. Typed Git mounting, private-repository authorization, and branch/PR workflows remain deferred.
- **CSV analysis:** direct Codex and Claude Code invocations with Project model credentials execute real tools to produce verified reports, charts, and result data. Follow-up seconds or days later retains the same Session, workspace, native conversation, and admitted configuration, including after forced reclamation. Verify a context-dependent modification using prior files without re-supplying them, including workspace files outside published artifacts. Record server-observed elapsed time and confirm no intervening turn. Recovery remains available for at least 30 days after the last successful turn, renewed by successful follow-up, with explicit expiry and preserved history/artifacts. Use controlled-clock tests for retention boundaries and actual delayed runs for live recovery. One minute and seven days express equivalent continuation semantics; they do not impose a separate seven-day observation gate. Label each observed interval truthfully.

Keep checkpoint as the turn durability and safe-reclamation gate. Required artifacts, events, usage, and a ready checkpoint precede successful completion and reclamation of an uncommitted workspace. Follow-up uses committed state; restore or checkpoint failure is explicit. Acceptance must prove actual continuation, not just backup creation. Failure and cancellation retain their actual outcomes and saved artifacts.

Use full access while retaining isolation and defer interactive approvals. Include creation idempotency, status/history/SSE, cancellation, and busy rejection. No input queue, steering, or Webhooks.

Direct calls accept inline configuration without creating a reusable Agent. Optional private presets are invoked by ID at their latest configuration, with immutable Session snapshots internally and no public version selector. Requests select one configuration source explicitly; they do not silently merge preset and inline fields. That callable path belongs here even if remaining Builder cleanup lands in #584. The provider charges the user’s BYOK account. The September 22 owner decision removes per-turn monetary budgets from this release; basic usage and cost estimates remain.

## #583 — Remove Package Lifecycle

Remove packages, manifest-as-public-lifecycle, and Fork. Preserve reusable instructions, Skills, MCP references, configuration snapshots, and promised user history. Existing destructive migration guardrails remain in force.

Retained private Agents are immediately callable by ID at their latest configuration. Internal immutable Session snapshots preserve admitted configuration; this slice does not introduce explicit historical-version invocation, package compatibility parsers, or a replacement distribution format.

## #584 — Configuration And Console

Expose private Agent creation/update entirely through API and console, immediately callable after saving. Remove Publish/Unpublish and Draft/Live/version-selection experiences. Retain existing MCP and Skills capabilities. A new Session uses the latest saved configuration; existing Sessions retain their initial snapshots. Any retained Preview/Test action executes through the ordinary Session API and appears in the same Session records.

Prioritize keys, API examples, Session records, artifacts, and usage in the console; Agent configuration is secondary. Input upload and output download suffice. New file-manager and online-editor work are deferred; this is not authorization to delete stored files.

## #636 — Separate Model Supply And Commercial Billing

The owner separated platform-supplied models, setup-free managed access, recharge, and commercial usage billing from #582 on September 19. Resolve the customer experience, pricing, funding, accounting, and any AI Gateway design before implementation of that commercial scope. It remains open and does not block the BYOK Session release. Truthful usage stays in #582; per-turn monetary budgets were later removed by the owner. Moving this scope does not imply that billing has shipped.

## Delivery Boundaries

With #581 shipped, preserve dependency order #582 -> #583 -> #584, with a working, verifiable path and data-preservation/rollback obligations for each slice. Favor reuse and the smallest implementation meeting SPEC. The GitHub issue descriptions were aligned with this reviewed scope on September 10; implementation and release evidence are still required before closing them.

Intentional breaking changes require a defined cutover, compatible client instructions, and Cloudflare user notification under the [release runbook](../production-deploy-verification.md#breaking-change-notification). The completed #581 key notice does not cover a later Session or Builder release. Platform supply and commercial funding decisions belong to #636; production budget configuration does not block #582. Existing Cloud customer evidence determines the migration work; terminology alone does not.

Current-state PRDs still describe Project/Thread, publishing, Agent Type, and package behavior. Update those notes as their implementation slices land; do not describe targets as shipped capabilities.
