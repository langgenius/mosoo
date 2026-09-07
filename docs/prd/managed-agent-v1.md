# Managed Agent v1: Remaining Execution Slices

Status: target scope from the 2026-09-08 owner interview. Implementation and remote issue reconciliation are pending. [SPEC](../SPEC.md) is the target contract.

## Completed Prerequisites

#579 (Channels) and #580 (App Deployment / bound capabilities) are closed with release evidence. Do not restore their product surfaces because inert historical storage remains.

## #581 — Workspace And Keys

Move current App/Project terminology and execution authentication to Workspace semantics while preserving resource identities, ownership, and history. Deliver key creation/revocation and strict cross-Workspace denial. Retain existing migration and SDK/CLI acceptance obligations; this is not just a UI rename.

## #582 — Managed Agents And Durable Sessions

Deliver the default-model, platform-funded first request and one public Session handle. Reuse runtime, files, events, usage, and checkpoints. Remove Pet/Cattle without removing native continuation.

Revise prior acceptance: replace typed Git resources and ghfind with CSV analysis and multi-turn modification; add renewable 30-day recovery and explicit expiry; use full access while retaining isolation; defer interactive approvals. Include per-turn budget protection, creation idempotency, status/history/SSE, cancellation, and busy rejection. No input queue, steering, or Webhooks.

Private Agents are invoked by ID at their latest configuration, with immutable Session snapshots internally and no public version selector. That callable path belongs here even if remaining Builder cleanup lands in #584. Hosted provider funding and budget defaults need operational resolution before quickstart acceptance.

## #583 — Remove Package Lifecycle

Remove packages, manifest-as-public-lifecycle, and Fork. Preserve reusable instructions, Skills, MCP references, configuration snapshots, and promised user history. Existing destructive migration guardrails remain in force.

## #584 — Optional Configuration And Console

Expose private Agent creation/update entirely through API and console, immediately callable after saving. Remove Publish/Unpublish and Draft/Live/version-selection experiences. Retain existing MCP and Skills capabilities.

Prioritize keys, API examples, Session records, artifacts, and usage in the console; Agent configuration is secondary. Input upload and output download suffice. New file-manager and online-editor work are deferred; this is not authorization to delete stored files.

## Delivery Boundaries

Preserve dependency order #581 -> #582 -> #583 -> #584, with a working, verifiable path and data-preservation/rollback obligations for each slice. Favor reuse and the smallest implementation meeting SPEC. Remote GitHub issues have not been edited by this documentation change.

Current-state PRDs still describe Project/Thread, publishing, Agent Type, and package behavior. Update those notes as their implementation slices land; do not describe targets as shipped capabilities.
