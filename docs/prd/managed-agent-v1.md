# Managed Agent v1: Remaining Execution Slices

Status: target scope from the September 9, 2026 owner decision: one task per Session, with checkpoint-gated completion and no continuation. [SPEC](../SPEC.md) is the target contract. The remaining slices require implementation and release evidence.

## Completed Prerequisites

#579 (Channels), #580 (App Deployment / bound capabilities), and #581 (Project keys and separate CLI login) are closed. Do not restore removed product surfaces because inert historical storage remains.

## #581 — Project And Keys: Shipped

Project is the shipped resource boundary: one account owns multiple Projects and each Project has multiple keys. Project settings provide key creation/revocation and strict cross-Project denial for Agent configuration, execution, and files. Account control-plane and cross-Project access use console or CLI login with a distinct account credential. The completed cutover rejects old account tokens and requires CLI re-login; it does not assign existing keys to a default Project. Resources and history were preserved, the compatible CLI was released, and Cloudflare accepted 153 user notices with sample inbox verification. See [#581 release evidence](https://github.com/langgenius/mosoo/issues/581#issuecomment-5582765337).

## #582 — Managed Agents And Single-Task Sessions

Deliver the default-model, platform-funded first request and one public Session handle. Each Session admits one task input; the Agent may make multiple model requests and tool calls while completing that task. Reuse runtime, files, events, usage, and checkpoints. Remove Pet/Cattle and public Thread continuation without deleting promised history or saved artifacts.

Replace typed Git resources and ghfind with a CSV analysis task that produces a verified report, chart, and result data. Use full access while retaining isolation; defer interactive approvals. Include per-task budget protection, creation idempotency, status/history/SSE, cancellation, and rejection of all further input to an existing Session. No input queue, steering, or Webhooks.

Keep checkpoint as the successful completion and safe-reclamation gate. Output files, events, usage, and a ready task checkpoint must be committed before reporting success or recycling the successfully executed task's workspace. Checkpoint failure is explicit. Failure, cancellation, and budget exhaustion retain their actual outcomes and saved artifacts. After runtime reclamation, history and saved artifacts remain readable without restoring a conversation. The earlier multi-turn, native-resume, and renewable 30-day recovery acceptance is removed; additional work creates a new Session.

Private Agents are invoked by ID at their latest configuration, with immutable Session snapshots internally and no public version selector. That callable path belongs here even if remaining Builder cleanup lands in #584. Hosted provider funding and budget defaults need operational resolution before quickstart acceptance.

## #583 — Remove Package Lifecycle

Remove packages, manifest-as-public-lifecycle, and Fork. Preserve reusable instructions, Skills, MCP references, configuration snapshots, and promised user history. Existing destructive migration guardrails remain in force.

## #584 — Optional Configuration And Console

Expose private Agent creation/update entirely through API and console, immediately callable after saving. Remove Publish/Unpublish and Draft/Live/version-selection experiences. Retain existing MCP and Skills capabilities. Each retained Test/Preview action creates a new ordinary single-task Session; it does not reopen a previous test as a conversation.

Prioritize keys, API examples, Session records, artifacts, and usage in the console; Agent configuration is secondary. Input upload and output download suffice. New file-manager and online-editor work are deferred; this is not authorization to delete stored files.

## Delivery Boundaries

With #581 shipped, preserve dependency order #582 -> #583 -> #584, with a working, verifiable path and data-preservation/rollback obligations for each slice. Favor reuse and the smallest implementation meeting SPEC. The scope and acceptance in #546 and the remaining issues follow this mapping.

Breaking changes are accepted with an explicit cutover, compatible client instructions, and Cloudflare user notification under the [release runbook](../production-deploy-verification.md#breaking-change-notification). A release cannot claim notification completion while intended recipients remain unattempted or outcomes are unknown. Preserve receipt evidence, distinguish provider acceptance from inbox delivery, and record any delivery failures and their disposition. The completed #581 notice does not notify users of a future Session lifecycle release.

Current-state PRDs still describe Project/Thread, publishing, Agent Type, and package behavior. Update those notes as their implementation slices land; do not describe targets as shipped capabilities.
