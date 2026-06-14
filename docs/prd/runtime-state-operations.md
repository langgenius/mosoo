# Runtime State Operations - For-Human PRD

> **Purpose**: This document explains what happens when an App owner saves Agent config, restarts runtime execution, recreates a sandbox, resets Pet agent-state, or hits the fork boundary.
>
> **Current App boundary note**: App is the V1 boundary. The App owns product navigation, resources, operations visibility, export, and usage/cost rollups. An App-local Agent owns runtime execution, Agent API Endpoint exposure, Channel delivery, DeploymentVersions, and Threads/Sessions. Runtime state operations run on that Agent inside the admitted App; the App summarizes the operation but does not become a runtime subject.
>
> **Related docs**: [SPEC](../SPEC.md), [App Boundary](./app-boundary.md), [Agent Exposure Identity](./agent-service-identity.md), [Agent Session Contract](./agent-session-api.md), and [Session Lifecycle](./session-lifecycle.md).

---

## 1. One-Line Positioning

Runtime state operations answer one owner question:

> "If I save this Agent change, restart the driver, recreate the sandbox, or reset agent-state, what happens to the Agent, its current Threads, its future Threads, and App Usage?"

The answer is:

- The Agent remains the runtime subject.
- App proof is required before any operation starts.
- Versioned config saves create a DeploymentVersion for future Sessions.
- Existing Sessions keep their own execution snapshot.
- Restart, patch, and recreate operations preserve Pet agent-state by default.
- Reset agent-state is a separate Pet-only danger action.
- Runtime/type changes after exposure or live-version lock are not applied in place; they go through Fork Agent.

---

## 2. Boundary With Session Lifecycle

| Concern                          | Product noun         | Runtime noun                  | Primary document                            |
| -------------------------------- | -------------------- | ----------------------------- | ------------------------------------------- |
| Keep a conversation usable       | Thread               | AgentSession / Session        | [Session Lifecycle](./session-lifecycle.md) |
| Apply Agent changes safely       | Agent inside one App | DeploymentVersion / operation | This PRD                                    |
| Preserve runtime-local Pet state | Agent agent-state    | stable runtime subject        | This PRD                                    |

The two documents use one hard rule:

> Runtime operations may briefly move active Sessions into an updating/rescheduling state, but they must not switch an existing Session to a newer DeploymentVersion, Environment revision, Skill set, MCP set, Storage binding, model, provider, or runtime.

When product copy talks to a caller, say **Thread**. When implementation or runtime copy talks about the frozen execution record, say **Session** or **AgentSession**.

---

## 3. User Problem

An App owner editing an App-local Agent needs concrete answers before pressing Apply:

- Will this save create a new DeploymentVersion?
- Will it affect current Threads, or only future Threads?
- Will it restart the Agent driver?
- Will it rebuild the sandbox?
- Will Pet login state, cache, memory, or native sessions survive?
- Is this actually a runtime/type identity change that must fork the Agent?

The dangerous failure modes are:

- A routine config save silently changes a running Session's execution snapshot.
- A restart or rebuild is described like a reset, making the owner fear data loss.
- Reset agent-state is shown on the main save path.
- Runtime/type changes are treated like ordinary config edits.
- A runtime id, endpoint token, channel payload, Session snapshot, or native resume pointer is accepted as App ownership proof.

---

## 4. Goals

- Make App the required access and operations boundary for every runtime state operation.
- Keep Agent as the only runtime subject.
- Separate config-change planning from destructive reset.
- Separate runtime/type Fork from restart, patch, recreate, and reset.
- Preserve agent-state for restart, patch, and recreate operations.
- Require strong confirmation before reset agent-state.
- Keep App Usage attribution tied to App, Agent, DeploymentVersion, Session, and Run proof.
- Keep current Threads on their frozen execution snapshot.

---

## 5. Concept Definitions

| Term                          | Product definition                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **App**             | The V1 product, resource, operation, export, and usage boundary. App is user-facing; App is the engineering name.                  |
| **Agent**                     | The App-local runtime subject. It owns execution, DeploymentVersions, endpoint exposure, Channel delivery, and V1 Threads/Sessions.    |
| **Thread**                    | User-facing conversation record. It is backed by one AgentSession in V1.                                                               |
| **AgentSession / Session**    | Runtime record behind a Thread. It freezes the Agent execution snapshot when created.                                                  |
| **DeploymentVersion**         | Immutable runnable Agent config snapshot for future Sessions.                                                                          |
| **agent-state**               | Pet runtime-local state: login tokens, cache, long-term local memory, and native session state. It is not Storage/Space.               |
| **direct-update**             | Metadata-only save with no DeploymentVersion and no runtime operation.                                                                 |
| **restart-process**           | Runtime operation that restarts the Agent process and preserves agent-state.                                                           |
| **patch-and-restart**         | Runtime operation that writes native runtime config, then restarts while preserving agent-state.                                       |
| **recreate-preserving-state** | Runtime operation that rebuilds the sandbox while backing up and restoring agent-state.                                                |
| **reset-agent-state**         | Pet-only danger action that clears agent-state. It is not config-triggered.                                                            |
| **Fork Agent**                | New Agent identity path for runtime/type changes after lock. The source Agent keeps Threads, logs, usage, endpoint history, and state. |

---

## 6. Operation Decision Matrix

| Owner intent                                   | Current operation path                         | DeploymentVersion impact              | Runtime impact                     | agent-state |
| ---------------------------------------------- | ---------------------------------------------- | ------------------------------------- | ---------------------------------- | ----------- |
| Rename Agent or edit description               | `direct-update`                                | None                                  | None                               | Unchanged   |
| Edit prompt                                    | `restart-process` when live runtime must apply | New live version for future Sessions  | Restart Agent process              | Preserved   |
| Edit model, provider, Skills, MCP, or options  | `patch-and-restart`                            | New live version for future Sessions  | Patch native config and restart    | Preserved   |
| Edit Environment or Storage/Space bindings     | `recreate-preserving-state`                    | New live version for future Sessions  | Recreate sandbox and restore state | Preserved   |
| Clear Pet runtime-local state                  | `reset-agent-state`                            | None                                  | Reset Pet runtime subject          | Cleared     |
| Change runtime driver or Agent type after lock | Fork Agent                                     | New Agent identity, not in-place save | No operation on the source Agent   | Source kept |

`fork-agent` is part of config-change planning so the UI can block the in-place save. It is not one of the restart / recreate / reset backend operations.

---

## 7. Apply Changes Flow

For versioned config saves:

1. The owner edits Agent config inside one App.
2. The system compares the draft against the current saved config.
3. The system picks the highest-impact action from the changed fields.
4. If the Agent is live and the action requires a DeploymentVersion, the save creates a new live DeploymentVersion for future Sessions.
5. If the action also requires a runtime operation, the UI shows an Apply dialog with the affected fields and agent-state preservation copy.
6. The runtime operation runs against the admitted Agent runtime subjects.
7. Current Sessions may receive updating/rescheduling events, then return to their existing snapshot.
8. New Sessions created after the save use the new live DeploymentVersion.

Draft Agents can save many changes without runtime operation because they have no live runtime subject yet. Live Agents must not hide runtime-impacting changes behind silent auto-save.

---

## 8. Runtime Restart / Patch / Recreate Semantics

### Restart Process

Use this when the Agent process needs to reload without changing the native sandbox shape.

- Preserves Pet agent-state.
- May briefly interrupt active Sessions.
- Does not change existing Session snapshots.
- Writes runtime operation events for connected viewers.

### Patch And Restart

Use this when native runtime config must be written before restart.

- Applies runtime-native config derived from the new DeploymentVersion.
- Preserves Pet agent-state.
- Does not change existing Session snapshots.
- Future Sessions use the new live DeploymentVersion.

### Recreate Preserving State

Use this when the sandbox image, Environment, network shape, setup output, or mounted Storage set requires a clean rebuild.

- Backs up Pet agent-state before rebuild when the runtime kind supports it.
- Restores Pet agent-state after rebuild.
- Explains expected downtime.
- Does not include Storage/Space files in agent-state deletion scope.

---

## 9. Reset Agent-State Danger Zone

Reset agent-state is separate from Apply Changes.

- It appears only where the Agent kind supports stable agent-state.
- It requires strong confirmation.
- It clears login tokens, cache, long-term runtime-local memory, and native session state.
- It does not delete Agent profile, prompt, Skills, MCP references, Provider credentials, Storage/Space files, Threads, Session history, logs, or App Usage.
- It cannot be used as a softer name for restart or recreate.

Cattle Agents have no Agent-level stable state to reset. Their Session sandboxes are lifecycle-managed by Session rules.

---

## 10. Fork Boundary For Runtime / Type Changes

Runtime driver and Agent type are identity-level choices once the Agent is live.

After exposure or live-version lock:

- Runtime driver changes are rejected in place.
- Agent type changes are rejected in place.
- The owner must Fork Agent to create a new Agent identity.
- The source Agent keeps its Threads, logs, usage attribution, endpoint history, channel history, and agent-state.
- The new Agent gets its own runtime subject and future DeploymentVersions.

Current UI may require the owner to create that fork explicitly. Do not describe runtime fork as an already-wired Apply Changes operation unless the implementation changes.

---

## 11. In-Flight Thread Behavior

When a runtime operation starts:

- Target Sessions move through an updating/rescheduling path only if they are admitted operation targets.
- Running viewers can receive an updating signal.
- Failed operations restore target state or mark recoverable failure according to runtime operation recovery.
- Completed operations return admitted targets to ready/idle state.
- No operation can mutate a Session execution snapshot to a newer DeploymentVersion.

This is why current callers can keep trusting their Thread history while owners keep improving future Agent behavior.

---

## 12. Fail-Closed Invariants

- Runtime operations require App owner proof and Agent ownership inside that App.
- Live Agent runtime operations require the caller's observed live DeploymentVersion and reject live-version drift.
- Runtime operation target admission must be fresh; partial stable-subject admission is rejected.
- Reset agent-state is rejected when the runtime kind policy does not support stable state reset.
- Runtime ids, endpoint tokens, Channel metadata, Session snapshots, package ids, native runtime paths, and resume pointers cannot prove App ownership.
- Usage and cost events must carry App proof; Agent/Session App mismatch is rejected.
- Existing Session snapshots cannot be used to bypass current App resource checks.
- Unknown operation names, stale target versions, or foreign App ids are rejected.

---

## 13. Copy Rules

- Say **App owner** or **Agent owner**, not governance roles.
- Say **Agent API Endpoint** when describing public HTTPS exposure.
- Say **Thread** for product-facing conversation copy.
- Say **Session** only for runtime implementation, snapshots, events, and tests.
- Say **recreate preserving state** when state is restored.
- Say **reset agent-state** only for destructive Pet runtime-local state clearing.
- Do not claim current V1 has runtime subjects, top-level public endpoints, browser deployment shells, or public preview links owned by the App.

---

> This PRD defines owner-facing runtime operation semantics. Engineering code may keep names such as `restartDriver`, `recreateSandbox`, and `resetAgentState` while product copy uses restart, recreate preserving state, and reset agent-state.
