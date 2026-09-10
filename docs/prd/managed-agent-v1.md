# Managed Agent v1: Remaining Execution Slices

Status: target scope from the September 10, 2026 product review. Single-turn tasks and multi-turn continuation share the same durable Session contract. [SPEC](../SPEC.md) is the target contract; the remaining slices require implementation and release evidence.

## #546 — API-First Managed Agent Runtime

An application supplies a Project key, Agent, input, and optional files. Mosoo owns execution, sandboxing, durable continuation, events, artifacts, usage, and cleanup. The application keeps its business logic, end-user identity, queue, validation, storage, and UI. Managed Codex and Claude Code are directly callable; saved private Agent configuration is optional and never requires publishing.

Both ghFind's single-turn evaluation and CSV analysis with follow-up are required acceptance paths. A single-turn integration does not restrict Session continuation. The parent and child issue descriptions follow this mapping, including removal of public historical-version selection and interactive approvals and deferral of typed Git infrastructure.

## Completed Prerequisites

#579 (Channels), #580 (App Deployment / bound capabilities), and #581 (Project keys and separate CLI login) are closed. Do not restore removed product surfaces because inert historical storage remains.

## #581 — Project And Keys: Shipped

Project is the shipped resource boundary: one account owns multiple Projects and each Project has multiple keys. Project settings provide key creation/revocation, with cross-Project denial for Agent configuration, execution, and files. Account control-plane and cross-Project access use console or CLI login with a distinct account credential. The completed cutover rejects old account tokens and requires CLI re-login; it does not assign existing keys to a default Project. Resources and history were preserved and the compatible CLI was released. Cloudflare accepted 153 user notices with sample inbox verification; see [#581 release evidence](https://github.com/langgenius/mosoo/issues/581#issuecomment-5582765337).

## #582 — Managed Agents And Durable Sessions

Deliver the default-model, platform-funded first request and one public Session handle. Reuse runtime, files, events, usage, and checkpoints. Remove Pet/Cattle without removing native continuation.

Require both acceptance paths:

- **ghFind:** one evaluation input and fixed-commit repository material produce validated analysis JSON, evidence JSON, and a Markdown report through one Session. Repeated idempotent creation does not duplicate work. History and saved artifacts remain readable after runtime reclamation, without requiring a follow-up turn. The concrete material delivery contract remains open; prefer existing file input capabilities with caller-prepared material. Typed Git mounting, private-repository authorization, and branch/PR workflows remain deferred.
- **CSV analysis:** managed Codex and Claude Code execute real tools to produce verified reports, charts, and result data. Follow-up seconds or days later retains the same Session, workspace, native conversation, and admitted configuration, including after forced reclamation. Verify a context-dependent modification using prior files without re-supplying them, including workspace files outside published artifacts. Recovery remains available for at least 30 days after the last successful turn, renewed by successful follow-up, with explicit expiry and preserved history/artifacts. Distinguish controlled-clock retention tests from actual elapsed-time evidence for delayed live continuation.

Keep checkpoint as the turn durability and safe-reclamation gate. Required artifacts, events, usage, and a ready checkpoint precede successful completion and reclamation of an uncommitted workspace. Follow-up uses committed state; restore or checkpoint failure is explicit. Acceptance must prove actual continuation, not just backup creation. Failure, cancellation, and budget exhaustion retain their actual outcomes and saved artifacts.

Use full access while retaining isolation and defer interactive approvals. Include per-turn budgets, creation idempotency, status/history/SSE, cancellation, and busy rejection. No input queue, steering, or Webhooks.

Private Agents are invoked by ID at their latest configuration, with immutable Session snapshots internally and no public version selector. That callable path belongs here even if remaining Builder cleanup lands in #584. Hosted provider funding and budget defaults need operational resolution before quickstart acceptance.

## #583 — Remove Package Lifecycle

Remove packages, manifest-as-public-lifecycle, and Fork. Preserve reusable instructions, Skills, MCP references, configuration snapshots, and promised user history. Existing destructive migration guardrails remain in force.

Retained private Agents are immediately callable by ID at their latest configuration. Internal immutable Session snapshots preserve admitted configuration; this slice does not introduce explicit historical-version invocation, package compatibility parsers, or a replacement distribution format.

## #584 — Optional Configuration And Console

Expose private Agent creation/update entirely through API and console, immediately callable after saving. Remove Publish/Unpublish and Draft/Live/version-selection experiences. Retain existing MCP and Skills capabilities. A new Session uses the latest saved configuration; existing Sessions retain their initial snapshots. Any retained Preview/Test action executes through the ordinary Session API and appears in the same Session records.

Prioritize keys, API examples, Session records, artifacts, and usage in the console; Agent configuration is secondary. Input upload and output download suffice. New file-manager and online-editor work are deferred; this is not authorization to delete stored files.

## Delivery Boundaries

With #581 shipped, preserve dependency order #582 -> #583 -> #584, with a working, verifiable path and data-preservation/rollback obligations for each slice. Favor reuse and the smallest implementation meeting SPEC. The GitHub issue descriptions were aligned with this reviewed scope on September 10; implementation and release evidence are still required before closing them.

Intentional breaking changes require a defined cutover, compatible client instructions, and Cloudflare user notification under the [release runbook](../production-deploy-verification.md#breaking-change-notification). The completed #581 key notice does not cover a later Session or Builder release. Resolve default model supply/budgets and the ghFind material input contract before accepting their corresponding capabilities.

Current-state PRDs still describe Project/Thread, publishing, Agent Type, and package behavior. Update those notes as their implementation slices land; do not describe targets as shipped capabilities.
