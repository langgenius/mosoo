# Mosoo Spec

Status: canonical target product contract for the next Mosoo launch. Implementation migration is in progress.

This document defines what Mosoo is building, the boundaries it guarantees, and the launch acceptance contract. It supersedes older Agent-first, Thread-first, external-Web-artifact, Workspace, and Organization-governance language whenever they disagree. Existing code and older PRDs are evidence about the migration baseline, not authority over this product model.

This Spec is deliberately narrower than a general-purpose application platform. Exact API schemas, manifest fields, quotas, and internal topology belong in implementation contracts once the engineering proof obligations in this document have passed.

## 1. Product Thesis

People can use local coding agents to create a runnable frontend quickly. The difficulty rises sharply when the App needs a backend, durable state, file storage, authentication, scheduled work, long-running agent execution, secrets, safe side effects, deployment, and recovery.

Mosoo serves Builders who have a runnable agentic-app prototype but do not want to become its DevOps, backend, and security team. The Builder continues authoring locally with Codex, Claude Code, OpenCode, or another compatible coding agent. Mosoo converts a repository that satisfies a strict contract into a hosted App that App Users can sign in to and use.

The product loop is:

```text
local coding agent + Mosoo Build Skill
  -> Deployable Repo
  -> local contract validation
  -> Mosoo-managed build and Release
  -> authenticated App Users
  -> durable business state and Agent Workload Runs
```

Mosoo's wedge is not “Agent Cloud,” generic AI integration, cloud code generation, or arbitrary application hosting. It is the production path for a supported class of agentic Apps.

### Evidence status

- Founder-built prototypes demonstrate that agentic business workflows and full-stack deployment create repeated operational work.
- Existing hosting and coding-agent products solve parts of that path but leave the Builder responsible for integration, security, and lifecycle correctness.
- Mosoo has not yet proved external adoption or willingness to pay. Production Alpha validates the product hypothesis; it is not evidence of product-market fit.

## 2. Target User And Job

### Builder

A Builder uses a local coding agent and Mosoo to create, own, and operate an App. The Builder may be an independent developer, operator, or small internal-tools team, but is not expected to be an infrastructure specialist.

The Builder's job is:

> Turn business-specific code that runs locally into a hosted agentic App without owning a custom deployment platform, agent runtime, auth service, durable job system, or security control plane.

### App Owner

The App Owner is the Builder responsible for the product offered to App Users. In the launch phase, one Mosoo Account owns an App. Team ownership, roles, invitations, and transfer are later extensions.

### App User

An App User uses the deployed App. App Users authenticate to that App, not to Mosoo, and should not need to know which agent runtime, model provider, or cloud service powers it.

### Mosoo Account

A Mosoo Account authenticates the Builder to the Mosoo control plane. It is never reused as an App User identity. An Organization may remain an internal billing or tenancy shell, but it is not the business-user model of deployed Apps.

## 3. Design Principles

1. **Local agents own authoring.** Mosoo does not compete for the programming conversation.
2. **The repository owns the product.** Business logic, schema, Skills, and domain semantics live in the App repository.
3. **The contract is strict.** Mosoo guarantees a narrow production profile, not best-effort deployment of arbitrary repositories or containers.
4. **The App is the product boundary.** Web, backend, auth integration, state, the Agent Workload, and Releases belong to one App.
5. **Agent execution is a capability, not an identity hierarchy.** An Agent Workload is part of an App; users do not first construct a separate cloud Agent resource.
6. **One action has one path.** Buttons and schedules use the same Dispatch operation and produce the same Run record.
7. **Durable state is explicit.** Database records and files outlive Sandboxes, processes, Runs, and Releases.
8. **High-impact side effects are mediated.** Prompts and UI warnings are defense in depth, not the authorization boundary.
9. **Production claims require recovery.** A runnable demo without isolation, backup, export, and rollback is not Production Alpha.
10. **Delete before generalizing.** Launch excludes broad SaaS templates, provider matrices, infrastructure choices, and governance that do not prove the wedge.

## 4. Canonical Product Model

```text
Builder / Mosoo Account
└── App
    ├── Deployable Repo
    ├── App Auth Realm
    ├── App-Owned State
    │   ├── Database records
    │   └── Durable files
    ├── Agent Workload
    │   ├── Trigger(s)
    │   ├── Dispatch
    │   ├── Workload Scope(s)
    │   └── Run(s)
    │       ├── Events
    │       ├── Artifacts
    │       └── Confirmation Gate(s)
    └── Release(s)
```

### App

An App is the complete hosted software product used by App Users. It combines conventional web SaaS behavior with one agentic business workflow in Launch.

An App includes:

- frontend assets and backend request handling;
- an isolated App Auth Realm;
- App-Owned State in a durable database and file store;
- App-scoped secrets and runtime bindings;
- one Agent Workload declaration and its Skills;
- immutable Releases and operational history.

An App is not a Mosoo resource folder, an external static artifact, a chat Agent, or a generic Service graph.

### App-Owned State

App-Owned State is the canonical end-user and business data whose schema and meaning belong to the App repository.

Mosoo provisions, protects, backs up, restores, and exports the storage. Mosoo does not promote the App's `Profile`, `Customer`, `Subscription`, `Role`, `Membership`, `Invoice`, or other business tables into shared control-plane entities.

### Agent Workload

An Agent Workload is an App-defined business workflow that delegates open-ended work to Mosoo's managed production agent runtime. Launch supports exactly one Agent Workload per App; that Workload may compose multiple named Skills and accept multiple manual or scheduled Triggers through one Dispatch operation.

An Agent Workload:

- is declared by the Deployable Repo;
- uses a versioned Skill contract and explicit inputs;
- may call deterministic App code and Mosoo-mediated capabilities;
- has Triggers but only one Dispatch path;
- records every execution as a durable Run;
- does not require the Builder to implement a custom agent loop.

A chat experience may be built by an App, but Thread or chat is not Mosoo's universal workload model.

### Trigger And Dispatch

A Trigger is an App-defined reason to request an Agent Workload execution. Launch supports manual and scheduled Triggers.

Dispatch is the single operation through which every Trigger starts the Workload. A button may supply prompt-like input and a schedule may supply generated input, but they must not call separate business implementations.

Dispatch:

- validates App identity, Workload, input, Workload Scope, and idempotency key;
- returns a `runId` without holding the request open for completion;
- creates exactly one canonical Run for an accepted request;
- records the Trigger source without changing execution semantics.

The idempotency key is scoped to the App and Workload. Repeating a key with identical normalized input returns the original `runId`; reusing it with different input fails as a conflict. A scheduled occurrence has one stable key so delivery retries cannot create duplicate Runs.

### Run

A Run is the durable record of one Dispatch execution. It is not an HTTP request, process, chat Thread, or transient Sandbox.

A Run records:

- lifecycle state and timestamps;
- immutable input references and Workload version;
- an append-only, monotonically ordered event stream;
- logs suitable for App User progress and Builder diagnosis;
- artifacts and staged state changes;
- cancellation, failure, retry, confirmation, and final outcome;
- model usage and resource usage for App-level metering.

SSE clients can disconnect and reconnect from a cursor without cancelling the Run. Cancellation is explicit and durable. Retries preserve the original Run's causal history rather than fabricating an unrelated chat session.

### Workload Scope

A Workload Scope is an App-defined identity boundary for durable file state shared by related Runs. The repository derives a stable `scopeKey` from business identity such as an App User, customer, engagement, or another domain record.

Mosoo treats `scopeKey` as opaque:

- state cannot cross Workload Scopes;
- state commits for the same Workload Scope are serialized;
- every commit compares the Run's recorded base version with the current scope version;
- a stale commit retries from current state or fails visibly and never overwrites newer state;
- business meaning remains in the App repository;
- a global App workspace and a platform-mandated per-user tree are both invalid defaults.

### Protected Action And Confirmation Gate

A Protected Action is a declared high-impact side effect, such as sending messages, transferring value, deleting durable data, or publishing externally.

A Confirmation Gate is Mosoo-enforced authorization for a Protected Action. The Run must first persist the exact action, normalized input, and digest. An authorized App User may then grant a one-time confirmation bound to that Run and intent.

Mosoo executes the capability only after confirmation and records the outcome. Retries must use downstream idempotency where available; ambiguous external outcomes fail closed for reconciliation rather than blindly repeating the action.

This guarantee applies only to Mosoo-mediated capabilities. The Mosoo Contract rejects a high-impact credential or capability unless it is classified as a Protected Action and bound to a mediated executor. Credentials capable of performing a Protected Action must not be exposed to arbitrary shell commands or unrestricted network access that could bypass the Gate. Prompt refusal clauses and confirmation dialogs remain defense in depth only.

### Release

A Release is an immutable, content-addressed version of the complete App. It includes code, frontend assets, declared runtime bindings, the Workload contract, and the migration intent required to activate that version.

A Release is not a source commit alone, a mutable deployment, or an external frontend artifact detached from the App backend and Agent Workload.

## 5. Mosoo Contract And Deployable Repo

### Supported launch profile

Launch accepts one Mosoo-supported Cloudflare application profile:

- TypeScript application code;
- static frontend assets plus a Worker-compatible backend;
- Mosoo-provisioned application database and object storage;
- Mosoo Auth integration;
- declared secrets and resource bindings;
- one declared Agent Workload with its Skills, Triggers, Workload Scope rules, and Protected Actions;
- deterministic dependency installation, validation, build, and migration commands.

The exact manifest and schema are versioned implementation contracts. Unknown fields fail explicitly or follow a documented forward-compatibility rule; they must not silently change production behavior.

Launch does not promise arbitrary Node servers, Dockerfiles, operating-system packages, cloud resources, runtime frameworks, or repositories that have not been adapted to the Mosoo Contract. The local coding agent is expected to perform that adaptation before deployment.

### Repository ownership

The Deployable Repo is the source of truth for:

- frontend and backend business behavior;
- database schema and forward-compatible migrations;
- business authorization and Profile semantics;
- Skills and deterministic helper code;
- Workload inputs, outputs, Triggers, and scope derivation;
- Protected Action declarations;
- required secret names and external integrations;
- health and acceptance behavior.

Secrets, production data, runtime tokens, and environment-specific resource identifiers must not be committed to the repository.

### Local authoring flow

1. The Builder describes the business and current code to a local coding agent.
2. The agent uses the Mosoo Build Skill and CLI contract to create or adapt the repository.
3. Local validation reports deterministic, actionable contract failures.
4. The Builder supplies App-scoped secrets through Mosoo, not source control.
5. Deployment submits a content-addressed source bundle; a public GitHub repository is optional provenance, not a prerequisite.

Mosoo does not host the coding conversation, pay for local coding-agent usage, or mutate the repository through an opaque cloud builder.

## 6. Hosted Infrastructure Boundary

Mosoo owns and operates the first production infrastructure profile on Cloudflare. Bring-your-own-cloud is not a launch option.

The App Owner retains ownership and migration rights over:

- source code;
- App authentication-identity export;
- database records and schema;
- durable files;
- Workload and Skill definitions.

Mosoo must provide raw, documented exports rather than a platform-only backup format. Hosted infrastructure is an operating model, not ownership of the App's business data.

### Deployment Kernel

The Deployment Kernel:

1. validates the Mosoo Contract;
2. installs and builds in an isolated Sandbox;
3. produces Worker modules and frontend assets;
4. provisions or binds the declared App resources;
5. applies only reviewed, expand-only migrations that remain compatible with both the active and candidate Releases;
6. runs candidate health and contract checks while verifying that the active Release remains compatible;
7. publishes into Mosoo's Workers for Platforms data plane;
8. activates the new Release only after all activation gates pass.

The Deployment Kernel takes only the deployment-layer scope demonstrated by VibeSDK: isolated builds, Worker bundling, asset publication, and Workers for Platforms dispatch. VibeSDK's prompt-to-app experience, hosted coding agent, template catalog, Think/Space product model, and single-Durable-Object application model are not Mosoo product dependencies.

### Release And Rollback

- Releases are immutable and addressed by content hash.
- A failed build, migration, or health gate never replaces the active Release. Any migration already applied before failure remains safe for the active Release because pre-activation migrations are expand-only and backward-compatible.
- Code rollback activates the most recent compatible Release without deleting App-Owned State.
- Applied production migrations are append-only and are not reversed automatically.
- A Release that cannot run against the current data schema is not rollback-compatible.
- Contract or destructive schema cleanup is outside the Launch deployment lane and cannot occur while an older Release may be activated.
- Code rollback does not reverse external business side effects already completed by a Run.

## 7. App Authentication

Every App has an isolated, App-branded Auth Realm operated by Mosoo. App Users authenticate to the App and do not see or receive a Mosoo Account.

Mosoo follows a Supabase-style responsibility boundary:

- Mosoo provides Auth APIs and an SDK;
- Mosoo stores authentication identities and verification state;
- Mosoo issues, verifies, refreshes, and revokes sessions;
- the App renders its own login and account experience;
- the App repository owns Profile, tenant, role, membership, entitlement, and business authorization records.

Launch supports email OTP only. Password auth, social login, App User OAuth connections, enterprise SSO, SAML, SCIM, MFA, and shared cross-App identity are later extensions.

Authentication identities are isolated per App and included in the App Owner's migration/export path. Identity export includes stable subject identifiers, verified contact identifiers, and lifecycle timestamps; it excludes active sessions, refresh tokens, OTP values, verification challenges, signing keys, and other authentication secrets.

## 8. Agent Runtime And Credentials

Local authoring may use Codex, Claude Code, OpenCode, or another coding agent. Production execution is a separate concern.

Launch supports one pinned, Mosoo-managed production agent runtime profile backed by an existing agent SDK or CLI contract. Mosoo manages:

- runtime provisioning and isolation;
- Dispatch and Run lifecycle;
- Skill and capability injection;
- cancellation, timeouts, and hard budgets;
- usage metering and operational diagnostics.

When configuring production deployment through the Mosoo Build Skill and CLI, the Builder binds bring-your-own model credentials to Mosoo as App-scoped secrets. Those credentials are supplied by the Builder, never by App Users. Credentials and costs for the Builder's local coding agent remain outside Mosoo, and Mosoo does not fund or resell production model tokens in Launch.

There is no production runtime chooser or multi-provider compatibility promise in Launch.

## 9. Durable State And Files

App database state, durable files, Run history, and Sandbox files are different layers.

- **Application database** stores canonical structured business records.
- **Durable file storage** stores canonical App files and versioned Workload Scope state.
- **Run ledger** stores Run lifecycle, events, artifacts, and confirmation records.
- **Sandbox filesystem** is temporary execution state and must never be the only copy of business data.

Agent output enters a staging area. It becomes canonical state only through an explicit, atomic compare-and-swap commit against the Workload Scope's recorded base version. A crash before commit must leave the previous canonical state readable; a stale base version must retry from current state or fail visibly instead of overwriting it.

Restarting a Worker, Sandbox, or runtime process must not erase App-Owned State or make a completed Run disappear.

## 10. Required Product Flows

### Build And deploy

1. Builder opens an existing repository with a local coding agent.
2. The Mosoo Build Skill makes the contract and validation failures available to the agent.
3. The repository passes local validation.
4. Builder binds required App secrets and requests deployment.
5. Mosoo builds, provisions, migrates, validates, and creates an immutable Release.
6. Mosoo activates the Release at a Mosoo-managed URL.
7. A failed step shows a concrete failure and leaves the previous Release active.

### App User login

1. App User visits the App URL.
2. The App presents its own email OTP experience.
3. Mosoo Auth verifies the identity and supplies a trusted App-scoped subject.
4. The App resolves its own Profile and business authorization.
5. The App User never enters the Mosoo control plane.

### Manual And scheduled execution

1. A button or schedule creates a Trigger with Workload input and `scopeKey`.
2. Both call the same Dispatch operation.
3. Dispatch returns a `runId` and persists the Run.
4. The Run emits replayable events and artifacts.
5. The App can reconnect to SSE by cursor until the Run reaches a terminal or waiting state.

### Protected Action

1. A Run prepares a declared Protected Action.
2. Mosoo persists the exact intent and pauses the action.
3. The App shows the action to an authorized App User.
4. The App User confirms that exact intent once.
5. Mosoo executes through the mediated capability and records a receipt or ambiguous outcome.
6. A retry cannot silently perform the side effect again.

### Recovery

1. A Release or runtime failure does not delete App-Owned State.
2. Builder can inspect the failed Release and Run history.
3. Builder can reactivate a compatible prior Release.
4. Mosoo can restore App authentication identities, database state, and durable files from backup in a tested procedure.
5. App Owner can export the same categories in documented raw formats.

## 11. Security And Isolation Invariants

- Mosoo Account identity, App User identity, and model-provider credentials are separate domains.
- Every data access proves App identity before applying business scope.
- Auth subjects and sessions cannot cross Apps automatically.
- App database and file resources are isolated from other Apps.
- Workload Scope state cannot cross `scopeKey` boundaries.
- Same-scope state commits use version preconditions and cannot overwrite a newer commit.
- Secrets are encrypted at rest, excluded from logs and artifacts, and injected with least privilege.
- Protected Action credentials are available only to the mediated capability that enforces its Confirmation Gate.
- Arbitrary network and shell access cannot be treated as compatible with a Protected Action guarantee.
- Dispatch, confirmation, cancellation, retry, and Release activation are auditable state changes.
- Unsupported configuration fails closed; saved-but-unenforced security intent is not a production boundary.
- Resource, concurrency, duration, storage, model-usage, and egress limits are hard and visible to the Builder.

## 12. Production Alpha Contract

Mosoo may call an App **Production Alpha** only when all required gates pass.

### Required gates

- strict Mosoo Contract validation;
- isolated, reproducible build;
- App-scoped email OTP authentication;
- durable database records and files across restarts;
- encrypted, least-privilege secret injection;
- manual and scheduled Triggers sharing one Dispatch path;
- durable Run records, replayable events, SSE reconnection, and cancellation;
- serialized, version-checked Workload Scope commits;
- Mosoo-enforced Confirmation Gates for declared Protected Actions;
- immutable Release activation and compatible code rollback;
- encrypted automatic backups on a published schedule and an additional restore point immediately before each production migration, with retention derived from recovery proof rather than guessed;
- a restore drill completed before the first Production Alpha Release and after any change to the Auth, database, file, backup, or restore path, with measured recovery-point and recovery-time objectives published as product limits;
- raw export of App authentication identities, database data, and files in documented non-proprietary formats, with a manifest and checksums; authentication secrets, OTPs, and live sessions are excluded;
- explicit hard resource and cost limits;
- actionable failure states rather than silent fallback.

### Explicitly not promised

- uptime or support SLA;
- compliance certification;
- zero-downtime for every migration;
- automatic reversal of completed business side effects;
- arbitrary repository compatibility;
- custom cloud infrastructure or bring-your-own-cloud;
- stable APIs or backward compatibility during the product migration.

If the required gates do not pass, the App may be described as a preview or runnable prototype, not Production Alpha.

## 13. Launch Non-Goals

The launch contract does not include:

- a cloud prompt-to-app editor or hosted coding-agent workspace;
- a custom Mosoo agent loop;
- arbitrary Docker, Node server, framework, or cloud deployment;
- multiple production agent runtimes or a provider chooser;
- Mosoo-funded model usage, token credits, or token resale;
- public template marketplace or public use-case gallery;
- App billing, subscriptions, plans, products, prices, invoices, or payment processing;
- App teams, memberships, invitations, RBAC, ownership transfer, SAML, or SCIM;
- general-purpose transactional email or notification templates beyond Auth OTP;
- multiple production Agent Workloads in one App;
- custom domains or bring-your-own-cloud;
- generic CMS, analytics, backup administration, or localization modules;
- generic `Service`, `Agent Service`, `Workspace`, or polymorphic resource graphs;
- treating App business entities as Mosoo control-plane entities.

An App repository may implement business concepts such as customers, roles, or subscriptions when its product needs them. Their absence from Mosoo's launch primitives is not a ban on App behavior.

## 14. Migration From The Current Repository

The current repository contains shipped implementation that predates this Spec. The migration must preserve useful infrastructure while replacing the product model.

| Existing model                                                  | Canonical direction                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| App as a resource and console bucket with no runtime            | App as the complete hosted product boundary                                                 |
| Agent as the primary user-created runtime identity              | Agent Workload declared by the Deployable Repo                                              |
| Thread / Session as the universal execution model               | Dispatch and Run as the universal workload protocol; chat is optional App UX                |
| Public GitHub repository deployed as an external Web artifact   | Local or private Deployable Repo released as Web, backend, state bindings, and one Workload |
| Agent Deployment and App Deployment as separate product actions | One immutable App Release with explicit Workload runtime bindings                           |
| Session files and Sandbox persistence as the main file concepts | Durable App files and Workload Scope state separate from ephemeral Sandboxes                |
| Mosoo control-plane login as the only identity system           | Separate Mosoo Account and per-App Auth Realm                                               |
| Multiple exposed runtime/provider choices                       | One pinned production runtime profile for Launch                                            |

Migration rules:

- Existing Agent, Thread, Session, and Deployment tables may be reused internally, but their old semantics must not dictate new public APIs or console information architecture.
- Do not preserve conflicting product nouns merely for documentation compatibility.
- Do not claim a target capability is shipped until the corresponding Production Alpha gate has evidence.
- Older PRDs and architecture sections that conflict with this Spec are historical until rewritten.
- Generated schemas and clients follow implementation changes; they are not edited to simulate product alignment.

## 15. Engineering Proof Obligations

These are implementation investigations, not open PM decisions. Failure blocks or narrows Launch; it does not silently reopen the product boundary.

1. Prove a Worker plus assets can be published through Workers for Platforms with isolated App database, file, Auth, and secret bindings.
2. Prove Dispatch returns a durable `runId` and supports SSE replay, cancellation, retries, and confirmation without relying on one long HTTP request.
3. Prove canonical database/file state survives process loss, serializes same-scope writes, and promotes staged output atomically.
4. Prove Release activation, expand-only migration compatibility, code rollback, backup cadence and retention, measured recovery objectives, and checksum-verified raw export as one repeatable lifecycle.
5. Prove contract validation and hard limits prevent unsupported repositories, uncontrolled egress, runaway schedules, and unbounded runtime or model cost.

Limit values, concurrency, timeouts, and recovery objectives must be measured through these proofs and published as explicit product limits. They must not be guessed into the product model.

## 16. Acceptance Checklist

The product direction is aligned with this Spec when all of the following are true:

- README and active product surfaces describe Mosoo as the production path for locally authored agentic Apps, not “Agent Cloud” or prompt-to-app.
- A local coding agent can adapt an existing repository using a deterministic Mosoo Contract.
- Deployment accepts a local content-addressed bundle and does not require a public GitHub repository.
- One Release delivers frontend, backend, App bindings, and the App's single Agent Workload as one product.
- App Users authenticate to an isolated App Auth Realm through email OTP and never become Mosoo Accounts.
- The App repository owns Profile, authorization, schema, and business entities.
- Manual and scheduled Triggers call one Dispatch path and receive durable Run records.
- Run events reconnect by cursor and survive client, Worker, and Sandbox disconnects.
- Durable files and database records survive runtime replacement and Release changes.
- Repo-defined Workload Scopes isolate business file state; same-scope commits use base versions and cannot overwrite newer state.
- Protected Actions cannot execute before the exact intent is confirmed through a Mosoo-enforced Gate.
- Protected credentials cannot bypass the Gate through arbitrary shell or network access.
- Failed Releases do not replace the active Release or delete App-Owned State.
- Compatible code rollback, a published evidence-backed backup and recovery policy, a restore drill required by that policy, and checksum-verified raw export all have evidence.
- Hard limits fail explicitly before one App can create unbounded platform or model cost.
- No launch dependency requires App billing, teams, RBAC, custom domains, BYOC, public galleries, or multi-runtime support.
- Current implementation gaps remain visible as migration work instead of being described as shipped behavior.
