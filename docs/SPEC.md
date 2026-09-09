# Mosoo Product Spec

Status: canonical target product contract, updated after the product review on September 9, 2026. Single-turn tasks and multi-turn continuation share one durable Session contract. This document describes intended behavior; source, acceptance checks, and release evidence establish what is actually shipped.

## 1. Product Thesis

Mosoo is an open-source, API-first managed Agent runtime for application backends. Its first use cases are research, data analysis, file processing, and report generation. Agents can write code and run scripts to accomplish these tasks.

The application owns business logic, end-user authentication, business queues, result validation, business storage, and UI. Mosoo owns Agent execution, sandboxing, durable continuation, input files and artifacts, events, usage measurement, and runtime cleanup.

The core workflow is:

```text
Project API key + Agent + Input + optional files
  -> create a durable Session and execute work
  -> inspect status, read or stream events, download artifacts
  -> optionally send follow-up Input to the same Session
```

One admitted input starts one turn, which may include multiple model requests and tool calls. An application may complete its task in one turn or continue across several turns using the same Session API.

## 2. First Request And Ownership

- A developer creates one Project API key and completes a real task without first creating or publishing an Agent, selecting an Environment, or configuring model-provider credentials.
- Managed Codex and Claude Code Agents are immediately callable. Already integrated runtimes use a shared lifecycle; developer-supplied runtime integration is outside v1.
- Each managed Agent has a visible default model. Model overrides are supported, but first use does not require choosing a model. The actual model is recorded and fixed within the Session, with no silent model or runtime fallback.
- The hosted platform supplies default model access. Bring your own key (BYOK) remains optional where already supported. Default access does not promise free or unlimited inference.
- Project is the tenant and resource-ownership boundary. An account may own multiple Projects, each with multiple API keys. A key grants access only to its Project, including when the same account owns other Projects.
- Project keys serve trusted application backends. They may configure Agents, execute Sessions, and access files only within their Project, without fine-grained scopes. They cannot manage accounts, delete Projects, or manage API keys.
- Account owners use the console or CLI login for account management and cross-Project operations. CLI login credentials are distinct from application keys and may execute work in an explicitly selected owned Project.
- The completed #581 authentication cutover rejects old manually created account tokens and old CLI credentials. Users create new Project keys for integrations and log in again for CLI access; no default-Project reassignment is performed.
- Revoking a Project key rejects subsequent requests but does not cancel work already admitted. The owner or another active key in the same Project can inspect and cancel that work.

## 3. Optional Private Agents

- Developers may save reusable instructions, Skills, and existing MCP connection references as Project-private Agents. Creation and updates are available through both API and console; programmatic configuration does not require the console.
- Saving makes the Agent immediately callable.
- Public invocation uses an Agent ID. New Sessions resolve its latest configuration; there is no public historical-version selector.
- Each Session retains its initial configuration snapshot internally. Updating an Agent affects new Sessions only; existing Sessions keep their instructions, Skills, and tool configuration.
- Retain existing remote HTTPS MCP support, OAuth/Bearer authorization, connection ownership checks, and credential isolation, adapting them to Project and the new Session API.

## 4. Session Lifecycle And Durability

### Execution And Continuation

- `session_id` is the single primary public execution handle. Callers do not need to manage internal Run or retry Attempt IDs.
- Only one turn executes at a time in a Session. Busy Sessions reject new input, without input queuing or mid-execution steering.
- The active turn can be cancelled. Another input is accepted only after that turn ends; cancellation cannot undo completed external side effects.
- Completing a turn returns the Session to a state that accepts follow-up input; it does not terminate the conversation.
- Follow-up continues the same working directory and runtime-native conversation, including after sandbox reclamation.

### Checkpoint Gate

A checkpoint represents committed state that can be restored. It is the durability and safe-reclamation gate for each turn.

- After execution ends, persist artifacts, events, and usage, and commit a restorable checkpoint.
- Model or tool execution ending alone does not establish successful turn completion. Required artifacts and a ready checkpoint must be committed before reporting success or reclaiming the uncommitted workspace.
- Follow-up admission must continue from the preceding turn's committed state.
- Checkpoint failure is explicit; it must not fabricate success or silently discard uncommitted output.
- Failure, cancellation, and budget exhaustion retain their truthful outcomes and saved artifacts. A successful checkpoint does not turn those outcomes into successful execution.
- The same gate applies to single-turn tasks and multi-turn Sessions. Applications do not need to send a second input to obtain durable results.

### Reclamation, Recovery, And Expiry

- After sandbox reclamation, continuation restores the working directory and runtime-native conversation. Restore failure is explicit and never silently starts an empty conversation.
- Recovery state remains available for at least 30 days after the last successfully completed turn. Each successful follow-up restarts the period, and expiry is visible to users. Live processes, network connections, and machine-wide temporary state are excluded.
- After recovery expiry, the old Session rejects continuation. History and saved artifacts remain viewable and are not automatically deleted by recovery expiry. This is not an indefinite retention promise or an exception to explicit deletion.
- Users may explicitly create a new Session with selected historical summary and saved artifacts. It receives a new ID and does not claim restoration of the old workspace or native conversation. Automatic rollover is not required.
- Record actual execution configuration, runtime/model, managed environment identity, turn inputs, attachment identities, events, artifacts, and usage. Internal retries preserve the turn's admitted inputs.

## 5. Execution Permissions And Cost Controls

- Integrated runtimes use full-access execution within the Session sandbox and authorized resources. v1 does not provide interactive tool approvals.
- Full access retains Project isolation, credential protection, resource authorization checks, and budget enforcement.
- Each turn has a platform default budget. Callers may set a cap within platform limits. Once reached, stop issuing new model requests, preserve available artifacts, and explicitly report budget exhaustion.
- In-flight requests may cause a small overshoot; an exact hard financial ceiling is not promised.
- Record truthful usage and distinguish measured values from cost estimates. Settlement, invoices, subscriptions, and payments are outside this refactor.
- Default budgets, allowed caps, and platform provider funding and operational limits must be defined before default model access ships. This document does not assign values that have not been decided.

## 6. API And Console

- Session creation may include the first input. Follow-up input and cancellation use the same Session handle.
- Provide status retrieval, replayable historical events, and SSE. After disconnecting, callers can recover missed persisted events. v1 does not provide Webhooks.
- Creation supports an optional `Idempotency-Key`: within a Project, the same key and request return the original Session without duplicate work; reusing the key with a different request fails explicitly. Without a key, create a new Session.
- Prefer reusing existing mechanisms for follow-up idempotency instead of building a separate orchestration system. Deduplication details and key retention are implementation decisions; creation idempotency does not guarantee exactly-once external side effects.
- Support input file upload and artifact download. Users request modifications through Agent instructions; v1 does not require an online file editor or file-manager UI.
- Console onboarding prioritizes key creation and a minimal API example. After first use, Session records, status, artifacts, and usage are the primary surfaces. Private Agent configuration is secondary.
- Builder is a console client of the same Agent configuration and Session APIs. Any retained Preview/Test action uses an ordinary Session and appears in the same operational Session records.

## 7. Acceptance: Single-Turn Tasks And Multi-Turn Continuation

### Single-Turn Scenario: ghFind Repository Evaluation

1. ghFind uses a Project key to create or select a private evaluator Agent that is callable immediately after saving.
2. Submit one evaluation input and fixed-revision repository material, receiving one Session ID.
3. Require no Agent Publish, Environment setup, App Deployment, or additional public Run ID.
4. Execute real tools and produce analysis JSON, evidence JSON, and a Markdown report.
5. Follow Session status and events, download the three artifacts, and validate their structure, content, and correspondence to the input material.
6. Repeating an idempotent create request returns the same Session without duplicate execution. Internal retries use the same fixed input material.
7. Successful completion satisfies the artifact-persistence and checkpoint gate. After runtime reclamation, status, historical events, and saved artifacts remain readable.
8. Complete this business acceptance in one turn without requiring follow-up input. ghFind retains its own analysis ID, queue, rubric, validation, storage, and UI.

**Open decision: repository input delivery.** Acceptance must record the fixed commit and material actually used. Prefer caller-prepared material from that commit through existing file input capabilities; #582 must settle the concrete input contract. Typed Git Resource mounting, private-repository authorization, and branch/PR workflows remain deferred extensions rather than implicit requirements of this acceptance case.

### Multi-Turn Scenario: CSV Analysis And Follow-Up

1. Create a Project API key and upload a CSV.
2. Invoke a managed Agent with analysis instructions without configuring a provider, publishing an Agent, or selecting an Environment. Both Codex and Claude Code must execute real tools.
3. Read status and events, then download an analysis report, chart, and result data. Verify calculations against a known fixture and check artifact formats.
4. Request modifications in the same Session and verify existing files and native conversation continuity. Repeat after forced runtime reclamation.
5. Create a private Agent with reusable analysis instructions through the API and repeat the flow. After updating the Agent, new Sessions use the new configuration while existing Sessions retain their original configuration.

### Shared Failure And Boundary Checks

- Duplicate creation and reuse of an idempotency key with a changed request.
- Input submitted while a Session is busy.
- Cancellation, budget exhaustion, and truthful outcome reporting.
- Checkpoint failure preventing false success and unsafe reclamation.
- Cross-Project denial and credential isolation.
- Recovery after reclamation, with explicit failure instead of an empty-conversation fallback.
- Recovery expiry rejecting continuation while history and saved artifacts remain readable.

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

## 9. Implementation Status And Execution Slices

Existing code provides runtime adapters, sandboxes, Thread/Run history, checkpoint recovery, files, MCP, events, and usage. Project keys and separate CLI login shipped in #581. The new Session contract and remaining product cleanup still need implementation and real acceptance evidence. This document does not establish production reliability, adoption, willingness to pay, or task economics.

| Issue | Status And Responsibility                                                                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #546  | Overall Vision: an API-first managed Agent runtime.                                                                                                             |
| #579  | Closed: remove Channels from Mosoo main.                                                                                                                        |
| #580  | Closed: remove App Deployment and bound-capability coupling.                                                                                                    |
| #581  | Shipped: multiple Projects, Project keys, separate CLI login, authentication cutover, and user notification.                                                    |
| #582  | Remaining: managed Agents and one durable Session API, single-turn and multi-turn acceptance, checkpoint and recovery, and removal of the Pet/Cattle dual type. |
| #583  | Remaining: remove Package, Manifest, and Fork product lifecycles while preserving necessary configuration and history.                                          |
| #584  | Remaining: optional private Agent configuration and testing, without publishing or public version selection.                                                    |

Remaining work follows #582 -> #583 -> #584, with a working acceptance path and a migration rollback point for each slice; see the [execution scope mapping](./prd/managed-agent-v1.md). #581 has [release evidence](https://github.com/langgenius/mosoo/issues/581#issuecomment-5582765337). Reconcile #546 and its children with this contract: retain ghFind alongside multi-turn acceptance, defer typed Git infrastructure and interactive approvals, and remove public historical-version selection.

## 10. Migration And Breaking-Change Notification

Migration preserves existing resource identities, ownership, and promised history, without redesigning Organization governance. Production D1 is append-only. Inventory active state before cutover and follow CONTRIBUTING.md. Destructive or data-rewrite migrations require explicit approval, backups, verification, and rollback plans. This document does not authorize destructive production operations.

Intentional breaking changes are accepted with a defined cutover, treatment of admitted work, compatible clients, migration instructions, and a rollback point. Prepare the affected audience and notice before release. Notices must state the effective time, actual changes, preserved data, and required user actions.

Use Cloudflare Email Service and retain sending outcomes plus sample inbox/content verification under the [breaking-change notification runbook](./production-deploy-verification.md#breaking-change-notification). Distinguish provider acceptance from inbox delivery; unattempted recipients or unknown outcomes cannot count as completed notification. Documentation synchronization alone does not trigger a release notice. A notice claiming the replacement is available follows deployment and verification of the API, console, and applicable CLI.

The completed #581 key notice does not cover later Session or Builder changes. Future notices describe the actual changes and migration steps of their release.

## 11. Open Decisions

1. **Default model access and cost controls:** concrete default models, hosted provider supply, default turn budgets, allowed caps, and operational limits.
2. **ghFind repository input contract:** the smallest way to supply fixed-commit material and record its identity for retries and validation.

Resolve these before accepting and shipping the corresponding capabilities.
