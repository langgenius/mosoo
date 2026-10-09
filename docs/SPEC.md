# mosoo Product Spec

The product contract: what mosoo promises and what it deliberately does not do. User-visible details live in the [product notes](./prd/README.md), engineering invariants in [architecture](./architecture.md), and release status and known gaps in GitHub issues.

## 1. Product

mosoo is an open-source, API-first managed Agent runtime for application backends. Its first uses are research, data analysis, file processing and report generation, where an Agent writes code and runs tools to do the work.

The application owns business logic, end-user authentication, business queues, result validation, business storage and UI. mosoo owns Agent execution, sandboxing, durable continuation, input files and artifacts, events, usage measurement and runtime cleanup.

```text
Project key + harness/model + instructions + input + optional files
  -> a durable Session; its first turn starts
  -> status, events and artifacts
  -> optional follow-up input to the same Session
```

This path needs no saved Agent, publication or Environment setup. One admitted input starts one turn, which may make many model requests and tool calls. A task can finish in one turn or continue across many through the same Session API.

## 2. Projects, keys and credentials

- A Project is the tenant and resource boundary. An account owns one or more Projects, and each Project has exactly one owner: there are no members, roles or invitations. First sign-in creates a Default Project.
- A Project key (`msp_`) is a backend secret bound to one Project. It configures Agent presets, runs Sessions and uses files in that Project, and nothing else: managing accounts, Projects, keys, credentials, MCP servers, Skills or Environments needs an account login, and requests for another Project are rejected. A key is shown once and stored only as a hash. Revoking it rejects later requests but does not cancel work it already admitted.
- Console and CLI login are account credentials that manage the account, its Projects and their keys. The CLI credential (`mcli_`) is separate from Project keys and runs work only in a Project the account owns.
- Model credentials are bring-your-own-key: they belong to the Project and the provider bills that account. mosoo supplies no models and enforces no spending cap or per-turn budget.

## 3. Configuration and presets

- A creation request names exactly one configuration source: inline (harness, provider, model, instructions) or a saved Project-private Agent preset by ID. The two are never merged, and inline execution creates no Agent.
- On `/api/v2` a preset resolves to its latest saved configuration; there is no public version selector. `/api/v1` keeps its published live-version rule ([Public Thread API](./prd/public-thread-api-surface.md)).
- Harness and model are independent choices. Creation validates the combination and the provider's model protocol, then freezes them with the instructions, Skills, MCP references and Environment revision; nothing falls back silently. A Session never changes harness, model or protocol, and editing a preset affects only new Sessions. [Runtime choice](./prd/runtime-catalog.md) lists the integrated harnesses.
- An Agent is reusable configuration (harness, model, instructions, Skills, the Project's remote HTTPS MCP servers, an Environment), never a shared writable machine. Every Session gets its own sandbox, workspace, native conversation and checkpoint lineage, whatever legacy type label its Agent carries.

## 4. Sessions and durability

### Turns

- The handle is one durable conversation ID, the existing `thread.id`. Callers never need internal Run or retry IDs.
- One turn runs at a time, and a finished turn returns the Session to idle for follow-up input. Input to a busy Session is rejected; there is no input queue and no mid-turn steering.
- The active turn can be cancelled. Cancellation cannot undo external side effects that already happened.
- A turn runs for at most two hours (`SESSION_RUN_TIME_LIMIT_MS`). At the limit mosoo cancels it as a caller would: it ends `cancelled` with error `run.time_limit_exceeded`.
- A turn that needs a new sandbox while mosoo or the account is at its sandbox limit (`ACCOUNT_CONCURRENT_SANDBOX_LIMIT` per account) fails at once with the retryable `runtime.capacity_exhausted`, which names the limit. mosoo does not queue it.

### Checkpoint gate

- A turn succeeds only when its events and usage are recorded and a ready checkpoint of its workspace and native conversation commits with it, so a single-turn task already has durable results. Model or tool execution ending is not success.
- Until that commit, no follow-up is admitted and the sandbox is not reclaimed.
- A checkpoint failure is explicit; it never reports success or silently drops output.
- Failed and cancelled turns keep their truthful outcome and any saved artifacts, and never replace the last committed checkpoint.

### Continuation

- A reply one minute or seven days after a completed turn has the same semantics, also after the sandbox was reclaimed. Cold continuation may take longer, but it exposes the same state as warm continuation: the working directory (including files outside `outputs/`, Git state and dependencies installed inside it), the harness's native conversation, the frozen configuration and Environment revision, and the recorded artifacts.
- Never carried over: live processes, sockets and machine-wide temporary state. Provider and MCP credentials are resolved again on every activation, so revoked access does not survive. Attachments are mounted read-only from file storage and never enter a checkpoint.
- A checkpoint belongs to exactly one Session in one Project and is never shared, even between Sessions of the same Agent.
- A missing or unrestorable committed checkpoint fails the continuation explicitly. mosoo never opens an empty workspace or conversation in its place, and never substitutes a new Session.

### Retention

- Formal and API Sessions have no inactivity deadline. Committed state is kept while the Session exists, survives archive and is deleted with the Session.
- The only Sessions that expire are console debug Previews, after 30 days without debugging activity; see [Session lifecycle](./prd/session-lifecycle.md).

## 5. Execution and usage

- Integrated harnesses run with full access inside the Session sandbox. Project isolation, resource authorization and credential protection still apply: provider keys and MCP credentials never enter the sandbox, which receives only expiring grants for them. Environment variables, by contrast, are readable inside the sandbox ([Environment](./prd/environment.md)). There are no interactive tool approvals.
- Usage is recorded truthfully: measured values stay separate from cost estimates, and missing measurements stay empty. mosoo issues no invoices, settlements or payments.

## 6. API and console

- The versioned Public Thread API is the external contract, described by the generated OpenAPI documents in [`apps/api/openapi`](../apps/api/openapi). `/api/v1` stays wire-compatible, enforced by `public-api:contract:check`; a naming change alone never justifies a new version.
- The console GraphQL schema is internal to first-party clients: the console and the CLI generated from it. Console Preview runs an ordinary Session.
- Existing Thread routes and IDs are the Session handle. Creation can carry the first input; follow-up input and cancellation use the same handle.
- Callers read status, persisted event history and an SSE stream that starts with the latest persisted events; stable event IDs let a reconnecting caller skip events it already has. There are no Webhooks.
- Creation and follow-up accept an optional `Idempotency-Key`, scoped to the Project for Project keys. The same key and request return the original result without new work; the same key with a changed request fails. This does not make external side effects exactly-once.
- Callers upload input files and download artifacts. There is no online file editor or file manager.

## 7. Acceptance

Both scenarios run without a pre-created Agent, through the same public contract, on Codex (`openai-runtime`) and Claude Code (`claude-agent-sdk`), with Project credentials, real tool execution and validated artifacts.

- **ghFind, single turn.** One input plus repository material pinned to an exact commit (a public URL the Agent fetches, or uploaded files) produces analysis JSON, evidence JSON and a Markdown report in one Session. Repeating the idempotent create returns the same Session without new work. After reclamation, status, events and artifacts stay readable.
- **CSV analysis, multi-turn.** An uploaded CSV produces a verified report, chart and result data. A follow-up seconds later, and another after forced reclamation, continue the same Session ID with its configuration, conversation context and files, including files outside `outputs/`, without the caller resupplying them. Through a saved preset the flow is the same, and editing the preset leaves admitted Sessions unchanged.
- **Both:** duplicate and changed idempotent creates, input while busy, truthful cancellation, checkpoint failure without false success, cross-Project denial, and explicit restore failure instead of an empty conversation.

[`scripts/public-api-session-workflow.ts`](../scripts/public-api-session-workflow.ts) (`just public-api-session-workflow`) runs the CSV path, except forced reclamation, against a non-production deployment.

## 8. Scope

- Removed, and not a backlog to restore: Channels; App Deployment and hosting; shared-machine (Pet/Cattle) Agent types; the personal-computer lifecycle, which belongs to Mosoo Computer.
- Still shipped, with removal tracked in issues: Agent Publish/Unpublish, Draft/Live and version history (#584); Agent Package import/export, Manifest and Fork (#583).
- Not provided: typed Git mounting, private-repository authorization and branch/PR workflows; developer-supplied runtimes, a connector marketplace and local MCP servers; interactive tool approvals, Webhooks and an online file editor or manager; platform-supplied models, recharge and billing (#636). An Agent can still use authorized tools for an individual task.

## 9. Migration and breaking changes

- Migrations keep resource IDs, ownership and history. Database rules: [CONTRIBUTING](../CONTRIBUTING.md#database-and-migrations).
- A runtime change keeps every continuable Session's ID, context, files and configuration. State that cannot be carried over is reported, never reconstructed by assumption, and the Session is never swapped for a new one.
- One-time conversions ship as a version-pinned release procedure, not as permanent code on main.
- An intentional breaking change needs a defined cutover, a plan for admitted work, compatible clients, migration steps, a rollback point and a notice to affected users; see [Breaking-Change Notification](./production-deploy-verification.md#breaking-change-notification).
