# Mosoo Product Spec

Status: canonical target product contract, updated after the product review on September 8, 2026. This document describes intended behavior; source, acceptance checks, and release evidence establish what is actually shipped.

## 1. Product Thesis

Mosoo is an open-source, API-first managed Agent runtime for application backends. Its first use cases are research, data analysis, file processing, and report generation. Agents can write code and run scripts to accomplish these tasks.

The application owns business logic, end-user authentication, business queues, result validation, business storage, and UI. Mosoo owns Agent execution, sandboxing, durable continuation, input files and artifacts, events, usage measurement, and runtime cleanup.

The core workflow is:

```text
Workspace API key + Agent + Input + optional files
  -> create a durable Session and execute work
  -> inspect status, read or stream events, download artifacts
  -> send follow-up Input to the same Session
```

## 2. First Request And Ownership

- A developer creates one Workspace API key and completes a real task without first creating or publishing an Agent, selecting an Environment, or configuring model-provider credentials.
- Managed Codex and Claude Code Agents are immediately callable. Already integrated runtimes use a shared lifecycle; developer-supplied runtime integration is outside v1.
- Each managed Agent has a visible default model. Model overrides are supported, but first use does not require choosing a model. The actual model is recorded and fixed within the Session, with no silent model or runtime fallback.
- The hosted platform supplies default model access. Bring your own key (BYOK) remains optional where already supported. Default access does not promise free or unlimited inference.
- Workspace is the tenant and resource-ownership boundary. A key grants access only to its Workspace, including when the same account owns other Workspaces.
- The API serves trusted application backends. Applications authenticate their end users and keep platform keys on the server.

## 3. Optional Private Agents

- Developers may save reusable instructions, Skills, and existing MCP connection references as Workspace-private Agents. Creation and updates are available through both API and console; programmatic configuration does not require the console.
- Saving makes the Agent immediately callable.
- Public invocation uses an Agent ID. New Sessions resolve its latest configuration; there is no public historical-version selector.
- Each Session retains its initial configuration snapshot internally. Updating an Agent affects new Sessions only; existing Sessions keep their instructions, Skills, and tool configuration.
- Retain existing remote HTTPS MCP support, OAuth/Bearer authorization, connection ownership checks, and credential isolation, adapting them to Workspace and the new Session API.

## 4. Session Lifecycle And Durability

- `session_id` is the single primary public execution handle. Callers do not need to manage internal Run or retry Attempt IDs.
- Only one turn executes at a time in a Session. Busy Sessions reject new input, without input queuing or mid-execution steering.
- The active turn can be cancelled. Another input is accepted only after that turn ends; cancellation cannot undo completed external side effects.
- Completing a turn returns the Session to a state that accepts follow-up input; it does not terminate the conversation.
- Follow-up continues the same working directory and runtime-native conversation, including after sandbox reclamation. Restore failure is explicit and never silently starts an empty conversation.
- Recovery state remains available for at least 30 days after the last successfully completed turn. Each successful follow-up restarts the period, and expiry is visible to users. Live processes, network connections, and machine-wide temporary state are excluded.
- After recovery expiry, the old Session rejects continuation. History and saved artifacts remain viewable and are not automatically deleted by recovery expiry. This is not an indefinite retention promise or an exception to explicit deletion.
- Users may explicitly create a new Session with selected historical summary and saved artifacts. It receives a new ID and does not claim restoration of the old workspace or native conversation. Automatic rollover is not required.
- Record actual execution configuration, runtime/model, managed environment identity, turn inputs, attachment identities, events, artifacts, and usage. Internal retries preserve the turn's admitted inputs.

## 5. Execution Permissions And Cost Controls

- Integrated runtimes use full-access execution within the Session sandbox and authorized resources. v1 does not provide interactive tool approvals.
- Full access retains Workspace isolation, credential protection, resource authorization checks, and budget enforcement.
- Each turn has a platform default budget. Callers may set a cap within platform limits. Once reached, stop issuing new model requests, preserve available artifacts, and explicitly report budget exhaustion.
- In-flight requests may cause a small overshoot; an exact hard financial ceiling is not promised.
- Record truthful usage and distinguish measured values from cost estimates. Settlement, invoices, subscriptions, and payments are outside this refactor.
- Default budgets, allowed caps, and platform provider funding and operational limits must be defined before default model access ships. This document does not assign values that have not been decided.

## 6. API And Console

- Session creation may include the first input. Follow-up input and cancellation use the same Session handle.
- Provide status retrieval, replayable historical events, and SSE. After disconnecting, callers can recover missed persisted events. v1 does not provide Webhooks.
- Creation supports an optional `Idempotency-Key`: within a Workspace, the same key and request return the original Session without duplicate work; reusing the key with a different request fails explicitly. Without a key, create a new Session.
- Prefer reusing existing mechanisms for follow-up idempotency instead of building a separate orchestration system. Deduplication details and key retention are implementation decisions; creation idempotency does not guarantee exactly-once external side effects.
- Support input file upload and artifact download. Users request modifications through Agent instructions; v1 does not require an online file editor or file-manager UI.
- Console onboarding prioritizes key creation and a minimal API example. After first use, Session records, status, artifacts, and usage are the primary surfaces. Private Agent configuration is secondary.

## 7. Reference Acceptance: CSV Analysis And Follow-Up

1. Create a Workspace API key and upload a CSV.
2. Invoke a managed Agent with analysis instructions without configuring a provider, publishing an Agent, or selecting an Environment. Both Codex and Claude Code must execute real tools.
3. Read status and events, then download an analysis report, chart, and result data. Verify calculations against a known fixture and check artifact formats.
4. Request modifications in the same Session and verify existing files and native conversation continuity. Repeat after forced runtime reclamation.
5. Create a private Agent with reusable analysis instructions through the API and repeat the flow. After updating the Agent, new Sessions use the new configuration while existing Sessions retain their original configuration.
6. Run targeted checks for duplicate creation, input submitted while busy, cancellation, budget exhaustion, cross-Workspace denial, and recovery expiry.

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

## 9. Implementation Status And Migration

Existing code provides runtime adapters, sandboxes, Thread/Run history, checkpoint recovery, files, MCP, events, and usage. Workspace keys, the new Session contract, and remaining product cleanup still need implementation and real acceptance evidence. This document does not establish production reliability, adoption, willingness to pay, or task economics.

#579 and #580 are closed. Remaining work follows #581 -> #582 -> #583 -> #584; see the [execution scope mapping](./prd/managed-agent-v1.md). #546 and its children still need reconciliation with this document, especially replacing ghfind/Git acceptance with CSV analysis and removing public version selection and interactive approval requirements.

Migration preserves existing resource identities, ownership, and promised history, without redesigning Organization governance. Production D1 is append-only. Inventory active state before cutover and follow CONTRIBUTING.md. Destructive or data-rewrite migrations require explicit approval, backups, verification, and rollback plans. This document does not authorize destructive production operations.
