# Harness Marketplace Experiment

Status: branch-only product experiment for [GitHub issue #546](https://github.com/langgenius/mosoo/issues/546). Do not merge this experiment as a production migration.

## Product hypothesis

> One Workspace API key runs any supported agent harness inside a reproducible cloud environment.

The first successful Run must not require an Agent, repository, Deployment, or framework. A saved, versioned Agent remains an optional reusable Run configuration. The public contract is Run-first:

```ts
await mosoo.run({
  harness: "claude-code",
  profile: "claude-code/mosoo-baseline@2026.08-experiment.2",
  input: "Analyze these files",
  environment: "mosoo/general", // optional; resolves to the Workspace default
});

await mosoo.run({
  agent: "ghfind/project-evaluator",
  input: { repository: "langgenius/dify" },
});
```

`harness` and `agent` are an exclusive union. A Harness Run may select one exact `id@version` Profile reference; omission resolves the current curated default, and admission freezes the resolved Profile identity and provenance revision. Supplying both `harness` and `agent`, or neither, fails before a runtime resource is created. Both paths use the same Workspace-scoped API key and the same Run lifecycle.

This experiment deliberately excludes billing, balances, exchange rates, broad plugin browsing, user-authored plugin presets, automatic profile assembly, third-party Marketplace publishing, and advanced observability.

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

## DeepSeek Harness: internal composition is not a northbound standard

Source was reviewed at DeepSeek Harness commit [`141eb6f`](https://github.com/deepseek-ai/deepseek-harness/commit/141eb6fef83422698aef7a981029e843e8161534), release `0.1.0-rc.8`, on 2026-08-19. Its README explicitly calls the project a developer preview with compatibility-breaking changes. The source supports three conclusions:

1. DeepSeek Harness is one Harness product, not a collection of interchangeable Mosoo Harnesses. Its [architecture](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/docs/architecture.md) makes the model adapter, tool registry, session log, and agent loop replaceable Cordis plugins. That is a powerful composition mechanism inside DSH; Cordis is not a cross-Harness Run protocol.
2. DSH itself already defines the right packaging layer. A profile is a named, runnable plugin tree assembled from ordered bundles, a profile patch, a home patch, and optional command-line overlays. A bundle is an installable patch layer. Mosoo must lock the effective composition and its dependencies; a mutable local profile name is not sufficient provenance.
3. A complete DSH `headless` distribution is a candidate Profile Version only after the Mosoo adapter can independently boot it, expose the normalized Run lifecycle, and produce benchmark evidence. Until then, the catalog represents DeepSeek Harness once and marks the locked `deepseek-harness/headless@0.1.0-rc.8` distribution unavailable. Its internal plugin graph remains implementation detail.

### Loop and policy interception map

The reviewed DSH turn flow and [tool pipeline](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/docs/tool-execution-pipeline.md) expose the following composition points. They describe behavior a locked Profile must declare and benchmark; they do not become new Mosoo public endpoints.

| DSH interception point | What it can change | Mosoo containment/evidence requirement |
| --- | --- | --- |
| `agent/pre-step` | Reject or rewrite claimed messages before a model step | Profile lock, prompt/task digest, session-log evidence |
| `agent/request` | Replace model-call configuration | Exact model/provider identity and token evidence |
| `tools/pre-execute` | Reorderable allow/deny/ask policy | Normalized approval record and declared policy |
| Registered monotonic guards | Final deny that later listeners cannot undo | Safety result and immutable guard composition |
| `tools/execute` | Wrap dispatch for timeout, retry, or metrics | Latency/attempt evidence and cancellation semantics |
| `tools/post-execute` | Block, replace, or add context to a result | Result provenance and safety findings |
| `agent/turn-stopping` | Observe or steer the final turn boundary | Stable terminal-state mapping |
| `fs/write-intent` / `fs/edit-intent` | Gate filesystem mutation below `tool-fs` | Side-effect inventory and Environment filesystem policy |
| `ctx.sandbox` backend | Wrap spawned processes in a confinement backend | Frozen Environment revision and Cattle isolation |

### Plugin abundance is not Marketplace supply

The community catalog [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/tree/2e4d8006f91b6c75c8ecc6e8295eeeb40dfa39f9) was audited at commit `2e4d800`. Its 1,566 YAML plugin entries come from 1,037 owners. The largest categories are UI (228), tools (199), development (134), session (94), workflow (90), usage (89), notifications (85), memory (85), themes (68), and fun (66). UI, themes, fun, usage, notifications, voice, docs, and plugin managers already total 635 entries (40.5%) before personal tools and workflows are counted.

Only three English descriptions mention `agent loop` or `agent-loop`: one Skill/workflow, one telemetry integration, and `pzc2004/dsh-frostfin`, which claims to replace the DSH loop by attaching Kimi Code over ACP. More importantly, the catalog's own [listing policy and disclaimer](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/2e4d8006f91b6c75c8ecc6e8295eeeb40dfa39f9/README.md) say that listing proves installability and description accuracy, does not rank quality, and is not a security review. Plugin count is therefore not evidence of independently runnable, comparable Harness supply.

The Marketplace unit is one verified, immutable `HarnessProfileVersion` or one complete Harness distribution. It must include:

- a globally stable `id@version` reference and immutable source revision;
- a normalized Run adapter and declared Environment/credential requirements;
- a locked composition with shell-equivalent trust called out explicitly;
- one benchmark case identity plus measured outcome, input/output tokens, latency, approvals, side effects, and safety findings;
- evidence links or Run IDs sufficient to reproduce the record.

Routing follows product ownership rather than catalog category:

- UI, themes, pets, voice, personal workflows, and local conveniences belong to the Pet/local-computer product.
- Agent loop, compaction, policy, model routing, and tool-composition ingredients may become locked Cattle Profile Versions only as part of a complete runnable composition.
- Sandbox and backend providers belong to Environment.
- Individual plugins never become Harness Marketplace SKUs.

### Trust boundary

DeepSeek's [Agent Presets contract](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/preset/agent-presets/README.md#trust) states that a preset is as privileged as the plugins it names and a user preset has shell-equivalent trust. Mosoo does not make that code safe by labeling it a Profile. Containment instead requires verified provenance, an immutable Profile Version, a frozen Environment revision, Cattle isolation, Workspace-scoped credentials and network policy, and explicit benchmark/safety evidence. Unknown or mutable Profile references fail before Session allocation. A Profile version change creates a new identity; an admitted Run never follows a moving profile pointer.

## Fragmentation: evidence, counterevidence, and boundary

### Before

An integrator selects a harness, learns its execution noun, builds its transport, maps its stream, implements its approval callback, decides how local files become durable artifacts, injects secrets in a harness-specific way, and separately models interrupt/resume. Switching harnesses changes application code and often changes infrastructure.

The repository already demonstrates the adapter cost: OpenAI runtime uses app-server/SDK semantics, Claude uses the Agent SDK interface, and OpenCode uses ACP. The Driver normalizes them only after an Agent-bound Mosoo Session has been created.

### After

The caller keeps one Workspace key, one endpoint, one exclusive `harness | agent` source selector, and one Run state machine:

```text
queued -> provisioning -> running -> waiting_for_approval -> terminal
```

Streaming events, approval responses, cancel, result, usage, and artifacts keep stable envelopes. The frozen Run source records the Harness version, exact Profile `id`, Profile version, immutable provenance revision, Environment revision, model, and either inline Run configuration or Agent-version provenance.

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

Work proceeds in this order; UI work does not advance while an earlier gate is open:

1. Preserve the historical OpenRouter evidence and its limited lesson: one familiar northbound contract can absorb heterogeneous adapters.
2. Document Managed Agent/Harness protocol fragmentation and the semantics Mosoo will not flatten.
3. Stabilize the Run contract and immutable Harness/Profile Version identity.
4. Execute the same benchmark case across at least two complete Harnesses or Profile Versions.
5. Only then expose a minimal list/selector for demand testing. Screenshots or a rough catalog are sufficient.

### Curated benchmark, not a gallery

The first comparison pair is `openai-codex/mosoo-baseline@2026.08-experiment.2` and `opencode/mosoo-baseline@2026.08-experiment.2`. Both catalogs admit `gpt-5.5`. Both receive exactly this task, whose UTF-8 SHA-256 digest is `9e039ca7afa9c66eaee63d80e63a3e50616fe0ac4bc3561f5f2e23f764ed4e37`:

> Review the repository and report the highest-severity correctness risk with evidence. Do not modify files.

Each measured record must capture outcome, input/output tokens, end-to-end latency, approval count, filesystem/network side effects, safety findings, exact Environment revision, and both Run IDs. Missing metrics remain `null`; they are never estimated from logs or replaced with catalog claims.

| Profile Version | Model/task comparable | Current evidence | Result |
| --- | --- | --- | --- |
| OpenAI Codex Mosoo baseline | Yes: `gpt-5.5`, exact task digest | `contract_smoke`: admission, frozen snapshot, normalized lifecycle wiring | `null` |
| OpenCode Mosoo baseline | Yes: `gpt-5.5`, exact task digest | `contract_smoke`: admission, frozen snapshot, normalized lifecycle wiring | `null` |
| Claude Code Mosoo baseline | No same-model pair selected | `not_run` | `null` |
| DeepSeek Harness headless `0.1.0-rc.8` | No Mosoo Driver adapter | `not_run`, unavailable | `null` |

`contract_smoke` is deliberately weaker than a benchmark: the current local API test proves that one Workspace key can admit both exact profiles and create no user Agent row, but its runtime provisioning is mocked and it records no model outcome or usage. The experiment has **not** passed the execution gate until two comparable records reach `measured` with real provider-backed Runs.

After that gate passes, recruit five target builders who already automate coding-agent work. Give each a new Workspace, BYOK instructions, one Workspace key, and the same Run client. Do not teach Agents during first use. The experiment succeeds only if all of these hold:

1. At least four of five builders complete an agentless Run within ten minutes, without creating an Agent or supplying a repository.
2. At least four of five run the same task through both measured Profile Versions; their stream/result/approval handling code remains unchanged.
3. At least three of five voluntarily choose a second Profile Version on a task of their own and identify a concrete reason such as capability, fallback, policy, or comparison. One or fewer falsifies the Marketplace wedge even if remote execution is useful.
4. Contract tests show identical lifecycle handling for success, provider failure, approval, cancel, and artifact publication; no Workspace can retrieve another Workspace's key, Run, credential, Agent, or Environment.
5. Every terminal Run exposes its frozen Harness/Profile source, Environment revision, measured usage, result, and artifacts. Unknown Profile references, unavailable distributions, and invalid `agent + harness` inputs allocate no Session.

If setup succeeds but the demand gate fails, narrow the product to a managed single-harness remote runtime. If users need adapter-specific events in their main path, shrink the common contract instead of silently discarding behavior. If live results cannot be made comparable, reject the switching claim rather than filling the Marketplace with heterogeneous plugins.

## Product and ownership model

| Noun | Owns | Does not own |
| --- | --- | --- |
| Workspace | API keys, credentials, Agents, Environments, Connections, Runs, resources, usage | A running Sandbox |
| Harness version | Harness distribution and northbound adapter identity, capability declaration, supported Profile Versions | Mutable user composition or a list of internal plugins |
| Harness Profile Version | Locked complete composition, runtime/backend, model default, provenance revision, Environment/credential requirements, trust declaration, benchmark case and evidence | Workspace secret values, mutable local preset state, unverified plugin claims |
| Environment revision | Packages, setup, env names, network policy, reproducible artifact, sandbox/backend provider | Prompt, Skills, MCP, model policy, loop behavior |
| Agent version | Optional reusable Harness/Profile defaults, instructions, Skills, MCP, tool permission policy, output schema, default Environment | Pet state or an always-online process |
| Run source snapshot | Harness version, exact Profile identity/revision, model, Environment revision, source kind, Agent-version provenance or inline configuration | A mutable pointer that changes after admission |
| Run | Input, lifecycle, events, approvals, result, artifacts, usage, caller provenance | Cross-harness native-state portability |

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

- Curated Harness Marketplace with stable Harness identity and a small set of locked, complete Profile Versions. Each Profile carries provenance, runtime and Environment requirements, shell-equivalent trust, benchmark status/evidence, and an exact Quickstart reference. There is no individual-plugin gallery.
- Workspace-scoped API keys. A key resolves its Workspace before input validation; Run requests do not repeat `workspaceId`.
- Exclusive `HarnessRunSource | AgentRunSource`, optional exact `profile` selector, a frozen Harness/Profile source snapshot, and a Run-first endpoint/client.
- Console information architecture: Marketplace globally; Home, API Keys, Runs, Agents, Environments, Connections, Usage, and Workspace Settings inside a Workspace.
- User-visible App copy becomes Workspace. Internal compatibility names remain documented rather than mechanically migrated.

### Compatibility boundary

The main repository can admit and freeze an agentless Run source, but the pinned Driver protocol currently requires `source.kind = "agent"` and an Agent ID. The protocol change is tracked in [mosoo-agent-driver #118](https://github.com/langgenius/mosoo-agent-driver/issues/118). The current isolated compatibility binding creates no user Agent row, but it is contract-smoke evidence rather than a new northbound protocol. This experiment must not copy harness startup logic into the API. A DeepSeek Harness Profile remains unavailable until it has a Driver adapter that consumes the same versioned union; Mosoo must not embed Cordis as the cross-Harness contract.

## Preview acceptance boundary

The branch is an executable product experiment, not a production migration. It may retain internal App-named storage and legacy migrations, but its public preview must:

- keep the Web surface to a minimal Profile list/selector and Quick Run; protocol, identity, and measured evidence take priority over Marketplace polish,
- allow an empty Workspace to issue a Workspace key and form an agentless Run,
- demonstrate two complete, locked Profile Versions behind the same request shape and record the exact Profile identity on each Run,
- show DeepSeek Harness once as an unavailable locked distribution until its adapter and measured benchmark exist,
- keep saved Agents as optional reusable configuration,
- expose no Deployment, Channel, Pet Terminal, reset, or long-lived online-state surface,
- show frozen Harness/Profile source, Environment revision, usage, results, artifacts, and benchmark evidence state on a Run,
- identify the Driver protocol gate honestly wherever a real provider-backed completion cannot yet cross it.
