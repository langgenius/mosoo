# Mosoo Product Spec

Status: canonical target product contract, updated after the product review on September 9, 2026. One Session executes one task; this supersedes the earlier multi-turn continuation target. This document describes intended behavior; source, acceptance checks, and release evidence establish what is actually shipped.

## 1. Product Thesis

Mosoo is an open-source, API-first managed Agent runtime for application backends. Its first use cases are research, data analysis, file processing, and report generation. Agents can write code and run scripts to accomplish these tasks.

The application owns business logic, end-user authentication, business queues, result validation, business storage, and UI. Mosoo owns Agent execution, sandboxing, durable task records, input files and artifacts, events, usage measurement, and runtime cleanup.

The core workflow is:

```text
Project API key + Agent + Input + optional files
  -> create a Session and execute one task
  -> persist outputs and commit the task checkpoint before reporting success
  -> inspect terminal status, replay events, and download saved artifacts
```

A task may use multiple model requests and tool calls. Single-task means one admitted application input per Session, not one model call. A new task creates a new Session.

## 2. First Request And Ownership

- A developer creates one Project API key and completes a real task without first creating or publishing an Agent, selecting an Environment, or configuring model-provider credentials.
- Managed Codex and Claude Code Agents are immediately callable. Already integrated runtimes use a shared lifecycle; developer-supplied runtime integration is outside v1.
- Each managed Agent has a visible default model. Model overrides are supported, but first use does not require choosing a model. The actual model is recorded and fixed within the Session, with no silent model or runtime fallback.
- The hosted platform supplies default model access. Bring your own key (BYOK) remains optional where already supported. Default access does not promise free or unlimited inference.
- Project is the tenant and resource-ownership boundary. A key grants access only to its Project, including when the same account owns other Projects.
- Project keys serve trusted application backends. They may configure Agents, execute Sessions, and access files only within their Project, without fine-grained scopes. They cannot manage accounts, delete Projects, or manage API keys.
- Account owners use the console or CLI login for account management and cross-Project operations. CLI login credentials are distinct from application keys and may execute work in an explicitly selected owned Project.
- The authentication cutover intentionally rejects old manually created account tokens and old CLI credentials. Users create new Project keys for integrations and log in again for CLI access; no default-Project reassignment is performed.
- Revoking a Project key rejects subsequent requests but does not cancel work already admitted. The owner or another active key in the same Project can inspect and cancel that work.

## 3. Optional Private Agents

- Developers may save reusable instructions, Skills, and existing MCP connection references as Project-private Agents. Creation and updates are available through both API and console; programmatic configuration does not require the console.
- Saving makes the Agent immediately callable.
- Public invocation uses an Agent ID. New Sessions resolve its latest configuration; there is no public historical-version selector.
- Each Session retains its initial configuration snapshot internally. Updating an Agent affects new Sessions only; existing Sessions keep their instructions, Skills, and tool configuration.
- Retain existing remote HTTPS MCP support, OAuth/Bearer authorization, connection ownership checks, and credential isolation, adapting them to Project and the new Session API.

## 4. Single-Task Session Lifecycle And Checkpoint

- `session_id` is the single primary public execution handle. Callers do not need to manage internal Run or retry Attempt IDs.
- Session creation includes the task input and starts its only application turn. A Session never accepts follow-up input, queued input, or mid-execution steering, whether it is active or terminal.
- The active task can be cancelled. After success, failure, cancellation, or budget exhaustion, additional work requires a new Session. Cancellation cannot undo completed external side effects.
- Reuse the existing checkpoint mechanism as the successful task commit and safe-reclamation gate. After execution ends, persist output files, events, and usage, exclude transient credentials and attachment mounts from the checkpoint, and commit a ready checkpoint associated with the task.
- Execution finishing alone is not successful Session completion. Do not report success or recycle a successfully executed task's uncommitted workspace before the checkpoint is ready. Checkpoint failure is explicit; it must not fabricate success or silently discard uncommitted output.
- Failure, cancellation, and budget exhaustion remain distinct truthful outcomes. Persist their outcome and any saved artifacts; they do not become successful tasks merely because cleanup or a checkpoint succeeds.
- Checkpoint is an internal durability boundary, not a public continuation, restore, or version-selection API. v1 does not promise a renewable recovery window, native conversation continuation, or restoration of a finished Session. Internal retention and cleanup must preserve promised history and saved artifacts; this is not an indefinite retention promise or permission to erase existing data.
- A caller may explicitly provide saved output from an earlier task as input to a new Session. It receives a new ID and does not inherit the old workspace or native conversation.
- Record actual execution configuration, runtime/model, managed environment identity, admitted task input, attachment identities, events, artifacts, and usage. Any internal retry preserves the same admitted input and Session identity; it does not accept another user turn or guarantee exactly-once external side effects.

## 5. Execution Permissions And Cost Controls

- Integrated runtimes use full-access execution within the Session sandbox and authorized resources. v1 does not provide interactive tool approvals.
- Full access retains Project isolation, credential protection, resource authorization checks, and budget enforcement.
- Each task has a platform default budget. Callers may set a cap within platform limits. Once reached, stop issuing new model requests, preserve available artifacts, and explicitly report budget exhaustion.
- In-flight requests may cause a small overshoot; an exact hard financial ceiling is not promised.
- Record truthful usage and distinguish measured values from cost estimates. Settlement, invoices, subscriptions, and payments are outside this refactor.
- Default budgets, allowed caps, and platform provider funding and operational limits must be defined before default model access ships. This document does not assign values that have not been decided.

## 6. API And Console

- Session creation requires task input. Status, events, artifacts, and cancellation use the same Session handle. There is no follow-up-input or reopen operation in the target API; existing Thread continuation entrypoints are removed at the lifecycle cutover.
- Provide status retrieval, replayable historical events, and SSE. After disconnecting, callers can recover missed persisted events. v1 does not provide Webhooks.
- Creation supports an optional `Idempotency-Key`: within a Project, the same key and request return the original Session without duplicate work; reusing the key with a different request fails explicitly. Without a key, create a new Session.
- Repeating an idempotent create request never reopens a terminal Session. Deduplication details and key retention are implementation decisions; creation idempotency does not guarantee exactly-once external side effects.
- Support input file upload and artifact download. Users request file modifications through instructions in a new task; v1 does not require an online file editor or file-manager UI.
- Console onboarding prioritizes key creation and a minimal API example. After first use, Session records, status, artifacts, and usage are the primary surfaces. Private Agent configuration is secondary.

## 7. Reference Acceptance: A CSV Analysis Task

1. Create a Project API key and upload a CSV.
2. Invoke a managed Agent with analysis instructions without configuring a provider, publishing an Agent, or selecting an Environment. Both Codex and Claude Code must execute real tools.
3. Verify that success and safe runtime reclamation require the task's ready checkpoint and persisted output. Download an analysis report, chart, and result data; verify calculations against a known fixture and check artifact formats.
4. Reclaim the runtime after successful completion and verify that Session status, persisted events, and saved artifacts remain available without restoring a conversation. Further input to the active or finished Session is rejected. A new task receives a new Session ID.
5. Create a private Agent with reusable analysis instructions through the API and repeat the task. After updating the Agent, new Sessions use the new configuration while previously admitted Sessions retain their original snapshots. Callers never select historical Agent versions.
6. Run targeted checks for duplicate creation, changed-body idempotency conflicts, cancellation, budget exhaustion, cross-Project denial, and checkpoint failure. Verify that a failed checkpoint cannot produce a successful completion or unsafe idle reclamation.

## 8. Scope Boundaries

### Legacy Product Surfaces To Remove

- Agent Publish/Unpublish, Draft/Live, and user-facing historical-version selection.
- Agent Package import/export, Manifest-centered product workflows, and Fork.
- The Pet/Cattle dual type and compatibility branches in Mosoo main.
- Channels, application deployment and hosting, and permanent personal-computer lifecycle. Personal Agent and computer experiences belong to Mosoo Computer.

These are not a backlog to restore automatically after v1. Internal configuration snapshots and neutral execution/recovery primitives may remain.

### Extensions Deferred From This Iteration

- Typed Git repository mounting, private repository authorization, and branch/PR workflows.
- Developer-supplied runtimes, a connector marketplace, and new local-process MCP support.
- Interactive tool approvals, Webhooks, online file editing, and a file-manager UI.
- Billing settlement, subscriptions, and payments.

These boundaries do not prohibit an Agent from using existing authorized tools for an individual task.

Multi-turn Sessions, follow-up-input APIs, reopening terminal Sessions, and user-facing native-conversation recovery are outside the single-task product contract. They are not acceptance requirements to restore after this refactor.

## 9. Implementation Status And Migration

Existing code provides runtime adapters, sandboxes, Thread/Run history and continuation, checkpoint recovery, files, MCP, events, and usage. #581 shipped Project keys, separate CLI login, and the legacy-token cutover; see its [release and notification evidence](https://github.com/langgenius/mosoo/issues/581#issuecomment-5582765337). The new single-task Session contract and remaining product cleanup still need implementation and real acceptance evidence. This document does not establish production reliability, adoption, willingness to pay, or task economics.

#579, #580, and #581 are closed. Remaining work follows #582 -> #583 -> #584; see the [execution scope mapping](./prd/managed-agent-v1.md). #546 and its remaining children follow this contract: CSV task acceptance, latest Agent configuration, full access, and checkpoint-gated completion replace the earlier Git/ghfind, historical-version, approval, and multi-turn targets.

Migration preserves existing resource identities, ownership, and promised history, without redesigning Organization governance. Production D1 is append-only. Inventory active state before cutover and follow CONTRIBUTING.md. Destructive or data-rewrite migrations require explicit approval, backups, verification, and rollback plans. This document does not authorize destructive production operations.

Breaking API and lifecycle changes are accepted for this refactor. This includes ending legacy Thread continuation; it does not authorize deleting existing history or saved artifacts. Inventory affected callers and active tasks, prepare compatible API/console/CLI instructions and a rollback point, and complete the [breaking-change notification checks](./production-deploy-verification.md#breaking-change-notification) before declaring the release complete. Notifications use Cloudflare Email Service, describe the actual cutover and required user actions, and retain per-recipient outcomes without publishing personal data. Documentation synchronization alone is not a feature release and must not trigger a premature rollout notice.
