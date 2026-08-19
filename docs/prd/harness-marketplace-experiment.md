# Harness Marketplace Experiment

Status: branch-only product experiment for [GitHub issue #546](https://github.com/langgenius/mosoo/issues/546). Do not merge this experiment as a production migration.

## Product hypothesis

> One Workspace API key runs any supported agent harness inside a reproducible cloud environment.

The first successful Run must not require an Agent, repository, Deployment, or framework. A saved, versioned Agent remains an optional reusable Run configuration. The public contract is Run-first:

```ts
await mosoo.run({
  harness: "claude-code",
  input: "Analyze these files",
  environment: "mosoo/general", // optional; resolves to the Workspace default
});

await mosoo.run({
  agent: "ghfind/project-evaluator",
  input: { repository: "langgenius/dify" },
});
```

`harness` and `agent` are an exclusive union. Supplying both or neither fails before a runtime resource is created. Both paths use the same Workspace-scoped API key and the same Run lifecycle.

This experiment deliberately excludes billing, balances, exchange rates, routing, presets, guardrails, classifiers, framework packages, third-party Marketplace publishing, and advanced observability.

## Historical evidence: what OpenRouter shipped in 2023

### Finding

High confidence: the first public OpenRouter surface did not have an official OpenRouter SDK. It offered a familiar request shape through existing libraries, while OpenRouter performed the provider adaptation behind that boundary.

- The official examples repository was created on [2023-07-14](https://github.com/OpenRouterTeam/openrouter-examples). Its first commit, [`621f197`](https://github.com/OpenRouterTeam/openrouter-examples/commit/621f1977c2a85348db7f6ccbd61c1d1dbf57a609), is titled `init with langchain script hitting openrouter`. That revision contains a LangChain.js `ChatOpenAI` example and switches models with provider-qualified names for OpenAI, Anthropic, Google, and Falcon. The repository has no 2023 tags or releases.
- The base URL was corrected minutes later in [`00a4eb4`](https://github.com/OpenRouterTeam/openrouter-examples/commit/00a4eb42b33b36fbd871dcfd01390dcb42aa11ea). On [2023-08-17](https://github.com/OpenRouterTeam/openrouter-examples/commit/d628fc09a227fe2f154cd211638e92cbdcc9c5b9), the official example added the `openai` npm package, configured `https://openrouter.ai/api/v1` as `baseURL`, selected a provider-qualified model, and demonstrated both Chat Completions and streaming.
- The official [TypeScript SDK](https://github.com/OpenRouterTeam/typescript-sdk) repository was created 2025-08-21, the [Python SDK](https://github.com/OpenRouterTeam/python-sdk) repository on 2025-08-22, and the [Go SDK](https://github.com/OpenRouterTeam/go-sdk) repository on 2025-11-13. Repository creation dates cannot prove that no private or deleted SDK existed, but together with the official 2023 examples and absence of tags/releases they are strong evidence that an OpenRouter-specific SDK was not the launch path.

The precise answer is therefore: users could call native HTTP, but the earliest surviving official example used LangChain's OpenAI client abstraction; within one month the official examples explicitly used the OpenAI npm SDK with a changed base URL. `curl` was possible, but it is not the first surviving official example.

### Why OpenAI compatibility reduced friction

High confidence: the OpenAI-shaped boundary was important because it reused client APIs, streaming conventions, and developer knowledge that already existed. It did not mean the underlying providers were natively compatible.

- OpenRouter's July example sent OpenAI-, Anthropic-, Google-, and Falcon-named models through one LangChain `ChatOpenAI` interface. That is direct evidence of OpenRouter-side normalization, not evidence that Anthropic or Google exposed OpenAI-native endpoints.
- The broader ecosystem was already copying the shape. LocalAI described itself as a “drop-in OpenAI API” in its [2023-04-19 rename commit](https://github.com/mudler/LocalAI/commit/80f50e6), and vLLM added an OpenAI-style Chat Completions endpoint on [2023-07-03](https://github.com/vllm-project/vllm/commit/49b26e2cec8c56594668905e853fe4af34336b05). Those are independent serving or aggregation layers, not native model-vendor protocols.

The product lesson is not to clone Chat Completions. A stateful harness Run has approvals, files, side effects, environment state, and cancellation semantics that a stateless model response does not. The reusable lesson is to make one small, familiar client contract absorb adapter differences.

## Current protocol comparison

Evidence below was checked on 2026-08-19 against first-party documentation and repository contracts. Product surfaces can change; links identify the reviewed contract.

| Concern          | Claude Managed Agents                                                                                      | Claude Code / Agent SDK                                           | OpenAI Codex CLI / app-server                                                              | OpenAI Codex cloud                                                                                                                | Current mosoo harness path                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Create execution | A [Session](https://platform.claude.com/docs/en/managed-agents/sessions) requires an Agent and Environment | `claude -p` or SDK `query()` starts a local process/query         | app-server `thread/start` then `turn/start`; the TS SDK starts a thread and spawns the CLI | A product task starts in a repository-preloaded cloud sandbox ([launch description](https://openai.com/index/introducing-codex/)) | `createAgentSession(agentId)` then enqueue a Session Run                                   |
| Continue input   | Add session events                                                                                         | Resume/continue a session ID or continue the SDK message iterator | `turn/start` on a thread, `turn/steer`, or resume thread                                   | Product UI/integrations; no general managed-task API was found in the reviewed public docs                                        | Send AG-UI events to the Session                                                           |
| Event stream     | SSE session events, including per-subagent thread streams                                                  | `stream-json` or async SDK messages                               | Bidirectional JSON-RPC notifications over stdio, WebSocket, or Unix socket                 | Product task progress                                                                                                             | AG-UI WebSocket fed by normalized Driver events                                            |
| Approval         | Confirmation events and responses                                                                          | Permission modes, hooks, and permission callbacks                 | Server-initiated approval requests with client responses                                   | Product approval UX                                                                                                               | Normalized permission request/response events                                              |
| Files/artifacts  | Resources plus files written to the session outputs directory                                              | Host working directory and local files; host decides persistence  | Host working directory; file-change/diff items and optional output schema                  | Task sandbox and repository changes                                                                                               | Session attachments and recorded Session artifacts                                         |
| Secrets          | Vault IDs and managed environment inputs                                                                   | Host process environment/configuration                            | Host process environment/configuration                                                     | Product-managed environment/repository configuration                                                                              | Workspace Vault; short-lived, model-bound proxy grants keep provider keys out of Sandboxes |
| Environment      | Managed Environment is required                                                                            | Host owns cwd, packages, network, and process environment         | Host owns cwd, sandbox mode, approval policy, and environment                              | Per-task cloud sandbox                                                                                                            | Frozen Environment revision, package artifact, setup, env, and network policy              |
| Cancel/recover   | Interrupt and persistent Session operations                                                                | Host abort/interrupt plus session resume                          | `turn/interrupt`; thread resume/fork/archive                                               | Product task controls                                                                                                             | Interrupt event; control-plane Session history; Cattle Sandbox is recycled                 |
| Subagents        | Explicit child-thread event streams                                                                        | Runtime-native subagent messages are exposed by current SDKs      | Collaboration/subagent items are runtime-specific events                                   | Product-specific                                                                                                                  | No stable public subagent contract; events may be preserved as harness-specific detail     |

Primary implementation references: Claude's [Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview), [events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming), and [session operations](https://platform.claude.com/docs/en/managed-agents/session-operations); the [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage); Codex [app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) and [TypeScript SDK](https://github.com/openai/codex/blob/main/sdk/typescript/README.md); and mosoo's own Runtime Catalog and Session contracts.

Confidence is high for the linked local/managed contracts. Confidence is medium for the negative claim about a general Codex cloud API: the reviewed official product and developer documentation exposed cloud tasks through product integrations, while the public SDK wraps the local CLI/app-server. An unpublished, private, or newly introduced API would falsify that claim.

## Fragmentation: evidence, counterevidence, and boundary

### Before

An integrator selects a harness, learns its execution noun, builds its transport, maps its stream, implements its approval callback, decides how local files become durable artifacts, injects secrets in a harness-specific way, and separately models interrupt/resume. Switching harnesses changes application code and often changes infrastructure.

The repository already demonstrates the adapter cost: OpenAI runtime uses app-server/SDK semantics, Claude uses the Agent SDK interface, and OpenCode uses ACP. The Driver normalizes them only after an Agent-bound Mosoo Session has been created.

### After

The caller keeps one Workspace key, one endpoint, one exclusive `harness | agent` source selector, and one Run state machine:

```text
queued -> provisioning -> running -> waiting_for_approval -> terminal
```

Streaming events, approval responses, cancel, result, usage, and artifacts keep stable envelopes. The frozen Run source records the Harness/version, Environment revision, model, and either inline Run configuration or Agent-version provenance.

### What can and cannot be unified

The control plane can unify admission, identity, Workspace isolation, source snapshots, environment materialization, lifecycle states, event envelopes, approval response transport, cancellation intent, result/artifact references, and usage dimensions.

It must not pretend that all native semantics are equal. Harness-native resume tokens, subagent topology, detailed tool events, checkpoint behavior, vendor permission modes, and filesystem side effects remain adapter-owned. The common envelope may carry typed extensions, but portable callers cannot depend on an extension. Cattle isolation means a follow-up Run receives platform history and declared resources, not an old process or hidden local machine state.

### Counterevidence

- Many users standardize on one harness and mainly want reliable remote execution. For them, a Marketplace selector adds discovery value but little switching value.
- Harnesses are differentiated by behavior and local ecosystem, not just protocol. A normalized envelope can hide capabilities users need.
- A model can often be swapped inside one harness. That may solve cost or quality choice without switching harness protocols.
- Cross-harness continuation is unsafe: native state and side effects are not portable even when text history is.

The Marketplace thesis is therefore not accepted by implementation alone. It has to prove that users value selecting or switching executable harnesses, not merely “Claude Code in the cloud.”

## Falsifiable experiment

Recruit five target builders who already automate coding-agent work. Give each a new Workspace, BYOK instructions, one Workspace key, and the same Run client. Do not teach Agents during first use.

The experiment succeeds only if all contract gates and the demand gate pass:

1. At least four of five builders complete an agentless Run within ten minutes of opening the Workspace, without creating an Agent or supplying a repository.
2. At least four of five run the same task through both `claude-code` and `openai-codex` by changing only `harness`; their stream/result/approval handling code remains unchanged.
3. At least three of five voluntarily choose a second harness on a task of their own and identify a concrete reason such as capability, fallback, or comparison. This is the demand gate. One or fewer doing so falsifies the Marketplace wedge even if remote execution is useful.
4. Contract tests show identical lifecycle handling for success, provider failure, approval, cancel, and artifact publication across both harnesses; no Workspace can retrieve another Workspace's key, Run, credential, Agent, or Environment.
5. Every terminal Run exposes one frozen source snapshot and a basic usage record. An agentless Run creates no Agent row. Invalid `agent + harness` input allocates no runtime resource.

If setup succeeds but the demand gate fails, narrow the product to a managed single-harness remote runtime. If users need adapter-specific events in their main path, shrink the common contract instead of silently discarding behavior.

## Product and ownership model

| Noun                 | Owns                                                                                                                            | Does not own                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Workspace            | API keys, credentials, Agents, Environments, Connections, Runs, resources, usage                                                | A running Sandbox                                           |
| Harness version      | Adapter identity, executable/backend version, capability declaration, supported models, credential and Environment requirements | User prompt, Workspace secret values, mutable Session state |
| Environment revision | Packages, setup, env names, network policy, reproducible artifact                                                               | Prompt, Skills, MCP, tools, output schema                   |
| Agent version        | Optional reusable Harness/model defaults, instructions, Skills, MCP, tool permission policy, output schema, default Environment | Pet state or an always-online process                       |
| Run source snapshot  | Harness version, model, Environment revision, source kind, Agent-version provenance or inline configuration                     | A mutable pointer that changes after admission              |
| Run                  | Input, lifecycle, events, approvals, result, artifacts, usage, caller provenance                                                | Cross-harness native-state portability                      |

## Source impact map

This map is intentionally semantic. Names containing `deployment`, `channel`, or `agent` are not bulk-deletion criteria.

### Remove from the experiment product

- App Deployment UI, GraphQL/API operations, build/publish executor, queues, Cloudflare Pages/Workers provisioning, deployment secrets, active schema exports, and current product tests. Historical migrations remain append-only evidence; the experiment does not rewrite them.
- Slack, Lark, Telegram, Discord, and WeChat Channel UI, GraphQL/API adapters, connection Durable Objects, delivery jobs/queues, credential adapters, active schema exports, and current product tests. Internal Session/Driver event delivery remains.
- Agent Type selection, Pet Sandbox choice, owner Terminal, reset/restart/hibernate controls, Agent online-state messaging, and per-Agent Channel settings.
- Public navigation and copy that present App, Deploy, Deployment URL, Channels, or long-lived Agent runtime state as product concepts.

### Keep

- Existing Agent records and immutable published configuration snapshots. A snapshot may still have an internal `deploymentVersionId` during the experiment; it is an Agent version, not App Deployment.
- Cattle's Session-scoped Sandbox subject, fresh provisioning, platform history restoration, current-message resources, artifact capture, Vault/BYOK proxying, usage ledger, and Run event/approval/cancel flow.
- Environments and immutable Environment revisions, Skills, MCP connections, provider credentials, file records/resources, Runs/Sessions, and `ghfind`-style Agent calls.
- Internal `appId`, App tables, and GraphQL ownership fields where renaming would be mechanical risk. The user-visible noun is Workspace.

### Add or rename at the public boundary

- Curated Harness Marketplace with stable slug, version, status, capabilities, supported models, required credentials, Environment requirements, and Quickstart.
- Workspace-scoped API keys. A key resolves its Workspace before input validation; Run requests do not repeat `workspaceId`.
- Exclusive `HarnessRunSource | AgentRunSource`, a frozen source snapshot, and a Run-first endpoint/client.
- Console information architecture: Marketplace globally; Home, API Keys, Runs, Agents, Environments, Connections, Usage, and Workspace Settings inside a Workspace.
- User-visible App copy becomes Workspace. Internal compatibility names remain documented rather than mechanically migrated.

### Compatibility boundary

The main repository can admit and freeze an agentless Run source, but the pinned Driver protocol currently requires `source.kind = "agent"` and an Agent ID. The protocol change is tracked in [mosoo-agent-driver #118](https://github.com/langgenius/mosoo-agent-driver/issues/118). This experiment must not copy harness startup logic into the API. Until a versioned Driver union lands, real agentless execution must fail explicitly at the Driver-admission boundary or use a clearly isolated compatibility adapter; it must never fabricate a user-visible Agent.

## Preview acceptance boundary

The branch is an executable product experiment, not a production migration. It may retain internal App-named storage and legacy migrations, but its public preview must:

- open on “Choose a Harness and run,”
- allow an empty Workspace to issue a Workspace key and form an agentless Run,
- demonstrate two existing harness catalog entries behind the same request shape,
- keep saved Agents as optional reusable configuration,
- expose no Deployment, Channel, Pet Terminal, reset, or long-lived online-state surface,
- show frozen source, Environment revision, usage, results, and artifacts on a Run,
- identify the Driver protocol gate honestly wherever a real provider-backed completion cannot yet cross it.
