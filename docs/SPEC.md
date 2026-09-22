# Mosoo Product Spec

Status: canonical target product contract, with API compatibility and Cloud migration clarified on September 18, 2026, the owner-approved BYOK release scope on September 19, seamless existing-Session continuation reaffirmed on September 21, and the Cloud debug Preview exception and direct-invocation-first direction on September 22. Single-turn tasks and multi-turn continuation share one durable Session contract. This document describes intended behavior; source, acceptance checks, and release evidence establish what is actually shipped.

## 1. Product Thesis

Mosoo is an open-source, API-first managed Agent runtime for application backends. Its first use cases are research, data analysis, file processing, and report generation. Agents can write code and run scripts to accomplish these tasks.

The application owns business logic, end-user authentication, business queues, result validation, business storage, and UI. Mosoo owns Agent execution, sandboxing, durable continuation, input files and artifacts, events, usage measurement, and runtime cleanup.

The core workflow is:

```text
Project API key + harness/model + instructions + Input + optional files
  -> create a durable Session and execute work
  -> inspect status, read or stream events, download artifacts
  -> optionally send follow-up Input to the same Session
```

One admitted input starts one turn, which may include multiple model requests and tool calls. An application may complete its task in one turn or continue across several turns using the same Session API.

## 2. First Request And Ownership

- The #582 release uses bring your own key (BYOK): a developer configures a model-provider account in the Project and creates a Project API key. The primary request supplies its harness, model, instructions, input, and optional files directly. It requires no pre-created Agent, Publish, App Deployment, or Environment setup.
- Codex and Claude Code use the same public execution contract. A saved private Agent is an optional reusable preset. Already integrated runtimes use a shared lifecycle; developer-supplied harness integration is outside this release.
- The selected harness and model are independent choices: the harness owns the tool/execution loop and the model supplies inference. Their supported combination is checked, recorded, and fixed within the Session, with no silent fallback. Model credentials remain Project-owned; the provider charges that account.
- Platform-supplied model credentials, recharge, and commercial usage billing are separate #636 work and do not block #582 acceptance or closure. Direct harness/model selection with Project credentials belongs to #582. No free or unlimited inference is promised.
- Project is the tenant and resource-ownership boundary. An account may own multiple Projects, each with multiple API keys. A key grants access only to its Project, including when the same account owns other Projects.
- Project keys serve trusted application backends. They may configure Agents, execute Sessions, and access files only within their Project, without fine-grained scopes. They cannot manage accounts, delete Projects, or manage API keys.
- Account owners use the console or CLI login for account management and cross-Project operations. CLI login credentials are distinct from application keys and may execute work in an explicitly selected owned Project.
- The completed #581 authentication cutover rejects old manually created account tokens and old CLI credentials. Users create new Project keys for integrations and log in again for CLI access; no default-Project reassignment is performed.
- Revoking a Project key rejects subsequent requests but does not cancel work already admitted. The owner or another active key in the same Project can inspect and cancel that work.

## 3. Optional Saved Private Agents

- Developers save reusable instructions, Skills, and existing MCP connection references as Project-private Agents. Creation and updates are available through both API and console; programmatic configuration does not require the console.
- Saving makes the Agent immediately callable.
- Public invocation accepts an inline execution configuration or an owned Agent ID as a preset. Inline invocation creates no hidden reusable Agent. Preset invocation resolves its latest saved configuration; there is no public historical-version selector. A request must select one source explicitly; this release does not silently merge inline fields with preset configuration.
- Each Session retains its effective initial configuration and configuration source internally. Updating a preset affects new Sessions only; existing Sessions keep their harness, model, instructions, Skills, and tool configuration. Changing a model or harness inside an existing Session is outside this release.
- Retain existing remote HTTPS MCP support, OAuth/Bearer authorization, connection ownership checks, and credential isolation, adapting them to Project and the new Session API.

## 4. Session Lifecycle And Durability

### Execution And Continuation

Within the recovery period, a user returning seconds or days later to the same Session must be able to continue the same work. The Session preserves its conversation context, working files, and admitted execution configuration across idle time and sandbox reclamation. Users do not need to restate prior work, upload the same material again, or create a replacement Session to continue. Recovery may take longer than warm continuation; continuity does not promise identical model wording or preservation of live processes.

The September 21 owner clarification makes the user-visible criterion explicit: replying within one minute and replying seven days later have the same continuation semantics. This applies to existing Cloud Sessions across the Cattle transition as well as newly created Sessions. Recovery and migration happen behind the same conversation ID; users are not required to move to another Session, reconstruct context, select replacement files, or perform a manual recovery step.

The September 22 owner decision permits one scoped exception: **Cloud debug Previews expire after 30 days without debugging activity**. They continue within that period; message/Run/file activity renews it, while history reads, console login, and maintenance do not. After expiry the Preview history and files may be cleaned up and returning to the draft starts a new Preview. There is no separate three-day rule. Formal/API-used Sessions retain the continuity contract, including Sessions with a legacy Preview label. Existing Preview enrollment requires an impact inventory, recoverable backup, and approved production cutover; no historical data is silently assigned the new policy. Active work and admitted uploads are protected from cleanup races. See [Thread Lifecycle](./prd/session-lifecycle.md#cloud-debug-preview-retention-unreleased).

The owner's final September 22 decision adds a **one-time legacy Cloud migration exception based on the Session's own activity**: reviewed old Pet Sessions with no calls or file activity in the preceding 30 days may become read-only, even when their account remains active. Publication and account activity inform the impact inventory but do not disqualify an otherwise inactive Session. Preserve history and saved files; returning users can start a new Session through direct invocation or an existing preset, without a promise to resume the old native context, workspace or unrecorded configuration. Refresh all Run outcomes, file uploads/edits/deletes, ownership and pending work before cutover. Unknown or active work remains protected; old maintenance or telemetry markers require evidence and guarded reconciliation rather than being assumed inactive. The debug Preview rule remains separate. This is not rolling inactivity expiry for formal Sessions or permission to delete data or execute a production migration.

- One durable conversation ID is the primary public execution handle. Existing `thread.id` and Thread routes can represent that Session; the contract does not require renaming them to `session_id`. Callers do not need to manage internal Run or retry Attempt IDs, although existing Run results remain compatible observability data.
- Only one turn executes at a time in a Session. Busy Sessions reject new input, without input queuing or mid-execution steering.
- The active turn can be cancelled. Another input is accepted only after that turn ends; cancellation cannot undo completed external side effects.
- Completing a turn returns the Session to a state that accepts follow-up input; it does not terminate the conversation.
- Follow-up continues the same working directory and runtime-native conversation, including after sandbox reclamation.

### Checkpoint Gate

A checkpoint represents committed state that can be restored. It is the durability and safe-reclamation gate for each turn. Actual continuation from that state establishes acceptance of the design; a successful backup operation alone does not prove the Session continuity promise.

- After execution ends, persist artifacts, events, and usage, and commit a restorable checkpoint.
- Model or tool execution ending alone does not establish successful turn completion. Required artifacts and a ready checkpoint must be committed before reporting success or reclaiming the uncommitted workspace.
- Follow-up admission must continue from the preceding turn's committed state.
- Checkpoint failure is explicit; it must not fabricate success or silently discard uncommitted output.
- Failure and cancellation retain their truthful outcomes and saved artifacts. A successful checkpoint does not turn those outcomes into successful execution.
- The same gate applies to single-turn tasks and multi-turn Sessions. Applications do not need to send a second input to obtain durable results.

### Reclamation, Recovery, And Expiry

- After sandbox reclamation, continuation restores the working directory and runtime-native conversation. Restore failure is explicit and never silently starts an empty conversation.
- Formal and API-used Sessions have no recurring inactivity deadline. Retain the committed workspace and native context needed for same-ID continuation while the Session exists; elapsed time or a failed follow-up does not expire that state. Live processes, network connections, and machine-wide temporary state are excluded. Explicit deletion still removes Session data.
- Cloud debug Previews alone may expire after 30 inactive days under their explicitly recorded policy. The separately reviewed inactive legacy migration cohort may become read-only with history and saved files retained. Neither exception enrolls other formal Sessions or permits substituting a new Session for their promised continuation.
- Record actual execution configuration, runtime/model, managed environment identity, turn inputs, attachment identities, events, artifacts, and usage. Internal retries preserve the turn's admitted inputs.

## 5. Execution Permissions And Usage

- Integrated runtimes use full-access execution within the Session sandbox and authorized resources. v1 does not provide interactive tool approvals.
- Full access retains Project isolation, credential protection, and resource authorization checks.
- The September 22 owner decision removes per-turn monetary budgets from #582. The API has no cost-cap parameter or budget response; no Mosoo spending ceiling is promised. Project model providers charge the configured BYOK account.
- Record truthful usage and distinguish measured values from cost estimates. Settlement, invoices, subscriptions, and payments are outside this refactor.
- Platform funding, customer balances, and commercial pricing belong to #636. Production budget configuration is not a #582 release prerequisite.

## 6. API And Console

- Extend the existing Thread API where its behavior satisfies this contract. Preserve compatible routes, IDs, response fields, and retry behavior. A terminology change alone does not justify a new API version, duplicate execution surface, or old-endpoint sunset.
- Session creation may include the first input. Follow-up input and cancellation use the same Session handle.
- Provide status retrieval, replayable historical events, and SSE. After disconnecting, callers can recover missed persisted events. v1 does not provide Webhooks.
- Creation supports an optional `Idempotency-Key`: within a Project, the same key and request return the original Session without duplicate work; reusing the key with a different request fails explicitly. Without a key, create a new Session.
- Prefer reusing existing mechanisms for follow-up idempotency instead of building a separate orchestration system. Deduplication details and key retention are implementation decisions; creation idempotency does not guarantee exactly-once external side effects.
- Support input file upload and artifact download. Users request modifications through Agent instructions; v1 does not require an online file editor or file-manager UI.
- Console onboarding explains Project provider configuration, key creation, and a minimal direct API example; saving an Agent is an optional configuration-reuse path. After setup, Session records, status, artifacts, and usage are the primary surfaces.
- Builder is a console client of the same Agent configuration and Session APIs. Any retained Preview/Test action uses an ordinary Session and appears in the same operational Session records.

## 7. Acceptance: Single-Turn Tasks And Multi-Turn Continuation

Both scenarios must work without pre-creating an Agent. Use the same public contract for Codex and Claude Code with Project credentials, real tool execution, and verified artifacts. Reject unsupported harness/model combinations explicitly; creation retries must not repeat execution. Verify Project boundaries, configuration snapshots, and same-ID cold continuation. Also retain the optional saved-Agent path, including proof that later preset edits do not change an admitted Session. The existing saved-Agent acceptance alone is insufficient for the direct-invocation target.

### Single-Turn Scenario: ghFind Repository Evaluation

1. ghFind uses a Project with configured model credentials and a Project key to select a harness/model and supply evaluator instructions directly. No evaluator Agent must be saved first; an owned saved evaluator is an optional preset.
2. Submit one evaluation input and fixed-revision repository material, receiving one Session ID.
3. Require no Agent Publish, Environment setup, App Deployment, or additional public Run ID.
4. Execute real tools and produce analysis JSON, evidence JSON, and a Markdown report.
5. Follow Session status and events, download the three artifacts, and validate their structure, content, and correspondence to the input material.
6. Repeating an idempotent create request returns the same Session without duplicate execution. Internal retries use the same fixed input material.
7. Successful completion satisfies the artifact-persistence and checkpoint gate. After runtime reclamation, status, historical events, and saved artifacts remain readable.
8. Complete this business acceptance in one turn without requiring follow-up input. ghFind retains its own analysis ID, queue, rubric, validation, storage, and UI.

**Repository input delivery.** ghFind may supply a public repository URL and an exact commit SHA for the Agent to fetch using existing tools, or attach material prepared from that commit. Caller upload is optional. Acceptance must record and validate the resolved commit and material actually used; retries must retain that identity. Typed Git Resource mounting, private-repository authorization, and branch/PR workflows remain deferred extensions rather than implicit requirements of this acceptance case.

### Multi-Turn Scenario: CSV Analysis And Follow-Up

1. Configure a model-provider account in the Project, create a Project API key, and upload a CSV without creating an Agent.
2. Select a harness/model and supply analysis instructions directly without publishing or selecting an Environment. Both Codex and Claude Code must execute real tools using the configured Project credentials.
3. Read status and events, then download an analysis report, chart, and result data. Verify calculations against a known fixture and check artifact formats.
4. Request modifications seconds later in the same Session and verify that the Agent uses prior conversation context and existing working files, including files outside the published artifacts, without being given that state again.
5. Repeat continuation after a multi-day idle interval within the recovery period and after forced runtime reclamation. Verify the same Session ID, admitted configuration, context-dependent task result, and prior file contents. Record server-observed timestamps and verify no intervening turn or resupplied state. Use controlled time and persisted fixtures to exercise retention, renewal, and expiry boundaries. The one-minute/seven-day examples describe the same continuity requirement, not a mandatory seven-day observation delay; require a distinct live interval only when a time-dependent behavior needs that evidence. Report the actual elapsed live interval without relabeling it as seven-day observation.
6. Create a private Agent with reusable analysis instructions through the API and repeat the flow. After updating the Agent, new Sessions use the new configuration while existing Sessions retain their original configuration.

### Shared Failure And Boundary Checks

- Duplicate creation and reuse of an idempotency key with a changed request.
- Input submitted while a Session is busy.
- Cancellation and truthful outcome reporting.
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
- Platform-supplied model credentials; recharge, commercial usage billing, settlement, subscriptions, and payments (#636). Direct harness/model selection using Project credentials is included in #582.

These boundaries do not prohibit an Agent from using existing authorized tools for an individual task.

## 9. Implementation Status And Execution Slices

Existing code provides runtime adapters, sandboxes, Thread/Run history, checkpoint recovery, files, MCP, events, and usage. Project keys and separate CLI login shipped in #581. The new Session contract and remaining product cleanup still need implementation and real acceptance evidence. This document does not establish production reliability, adoption, willingness to pay, or task economics.

| Issue | Status And Responsibility                                                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #546  | Overall Vision: an API-first managed Agent runtime.                                                                                                         |
| #579  | Closed: remove Channels from Mosoo main.                                                                                                                    |
| #580  | Closed: remove App Deployment and bound-capability coupling.                                                                                                |
| #581  | Shipped: multiple Projects, Project keys, separate CLI login, authentication cutover, and user notification.                                                |
| #582  | Remaining: BYOK direct harness invocation, optional presets, durable Sessions, both acceptance paths, recovery, Cloud migration, and Pet/Cattle retirement. |
| #583  | Remaining: remove Package, Manifest, and Fork product lifecycles while preserving necessary configuration and history.                                      |
| #584  | Remaining: private Agent configuration and console cleanup, without publishing or public version selection.                                                 |

#636 separately tracks platform model supply, setup-free managed access, recharge, and commercial usage billing; it is not a #582 dependency.

Remaining work follows #582 -> #583 -> #584, with a working acceptance path and a migration rollback point for each slice; see the [execution scope mapping](./prd/managed-agent-v1.md). #581 has [release evidence](https://github.com/langgenius/mosoo/issues/581#issuecomment-5582765337). The issue scope follows this contract: retain ghFind alongside multi-turn acceptance, defer typed Git infrastructure and interactive approvals, and remove public historical-version selection.

## 10. Migration And Breaking-Change Notification

Migration preserves existing resource identities, ownership, and promised history, without redesigning Organization governance. Production D1 is append-only. Inventory active state before cutover and follow CONTRIBUTING.md. Destructive or data-rewrite migrations require explicit approval, backups, verification, and rollback plans. This document does not authorize destructive production operations.

Session isolation changes the runtime ownership boundary, not just the Agent type name. New Sessions own their writable workspace, runtime-native conversation, credentials grants, and checkpoint lineage. An Agent definition is reusable configuration, not a shared writable machine. Historical Pet Sessions may already share files, memory, processes, and one Sandbox; changing a database label or allocating fresh empty Sandboxes does not migrate that state.

Before changing existing Cloud customers' behavior, inventory shared Sandbox membership, active work, saved/live configuration differences, and recoverable state. Preserve old resource IDs, history, artifacts, and end-user/MCP identity. Drain admitted work without replaying unknown external side effects. For each shared workspace, establish what belongs to each Session and transfer it internally; never copy shared secrets or other Sessions' private state into every new workspace. Verify restoration from isolated copies before releasing the old execution resource. Missing native or workspace state must be reported, not reconstructed by assumption.

Outside the reviewed inactive-Session exception above, existing continuable Sessions must retain their same-ID context, promised working files, and admitted configuration through migration. The owner rejected transferring these users to a replacement Session or asking them to rebuild missing context. An unverified or incomplete recovery blocks that Session's cutover and remains a #582 closure blocker; retain its existing mapping, data, and resources while investigating. Missing metadata alone does not establish data loss. Do not introduce retroactive expiry to avoid the migration obligation. Notices, readable history, or an explicit recovery error cannot substitute for a verified seamless transition. Engineering must resolve shared-state ownership and recovery without exposing another Session's private data or requiring the customer to perform the conversion.

The final main branch has one Session execution model, with no active Pet/Cattle fields or behavior and no permanent migration platform. Keep necessary one-time conversion, backup and rollback operations in a version-pinned release procedure with an explicit endpoint. The final deployment follows verified conversion of protected Sessions and read-only treatment of the approved inactive cohort; it must not remove protection from unconverted workloads. Inert historical schema fields, immutable applied migrations and compatible Thread routes may remain. Removing field names or rewriting old rows alone does not establish closure.

Intentional breaking changes are accepted with a defined cutover, treatment of admitted work, compatible clients, migration instructions, and a rollback point. Prepare the affected audience and notice before release. Notices must state the effective time, actual changes, preserved data, and required user actions.

Use Cloudflare Email Service and retain sending outcomes plus sample inbox/content verification under the [breaking-change notification runbook](./production-deploy-verification.md#breaking-change-notification). Distinguish provider acceptance from inbox delivery; unattempted recipients or unknown outcomes cannot count as completed notification. Documentation synchronization alone does not trigger a release notice. A notice claiming the replacement is available follows deployment and verification of the API, console, and applicable CLI.

The completed #581 key notice does not cover later Session or Builder changes. Future notices describe the actual changes and migration steps of their release.

## 11. Open Decisions

1. **Separate #636 commercialization:** platform model supply, default models, customer recharge, commercial pricing/billing, and financial limits. These decisions do not block the BYOK #582 release.

Resolve these before accepting and shipping the corresponding capabilities.
