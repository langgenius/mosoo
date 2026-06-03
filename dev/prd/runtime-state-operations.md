# Runtime State Operations — for humans

> This is the product-story version for non-engineering readers. For the full engineering contract (the 5-tier Action field mapping, Runtime backend orchestration, Screens specs, states and corner cases, decision boundaries, and Self-check), see the full Runtime State Operations PRD.

## One-line positioning

This PRD locks the runtime orchestration from the **admin / agent-owner** perspective: after editing prompt / skills / MCP / spaces / runtime, how do you Apply, how does the driver restart, how does the Pet agent-state survive, and when must you go through a danger confirmation.

[`session-lifecycle.md`](./session-lifecycle.md) focuses on the caller / consumer concern of "don't lose my session"; this document focuses on the admin concern of "don't lose my Pet agent-state".

**M1B-3 boundary**: This document depends on the immutable Session Execution Snapshot boundary already locked in [`session-lifecycle.md`](./session-lifecycle.md). It does not redefine the session lifecycle, and it does not allow Apply Changes to silently switch the DeploymentVersion / EnvironmentRevision of an existing session.

---

## 1. Boundary with session-lifecycle

| Concern                        | User perspective                                         | Primary owner                                    | Core question                                                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Don't lose the session**     | caller / consumer (employee / API client / Channel user) | [`session-lifecycle.md`](./session-lifecycle.md) | I'm mid-conversation with a customer. After the Agent hibernates and resumes, will it pick up where it left off?                                                                                                |
| **Don't lose the agent-state** | admin / agent owner                                      | **This PRD**                                     | For a Pet: after I edit the prompt/skill, the driver has to restart when I Apply — are the token / cache / native sessions I logged in earlier still there? For a Cattle: there is no Agent-level stable state. |

The two PRDs share the same underlying capabilities, but **they address different decision-makers and land on different UIs**.

---

## 2. User problem

After an admin edits the configuration of a Published Agent:

- They don't know whether saving this change will restart the agent.
- They don't know whether the Pet agent-state (login state / cache / long-term memory / native sessions) will be wiped.
- They don't know which fields trigger which level of operational action — does changing the model and changing the prompt both trigger the same thing?
- They worry that editing one unrelated field will destroy all of the agent's memory.

If the entry point for resetting agent-state lives on the main path, a slip of the hand while clicking Apply Changes triggers a disaster. That entry point is shown only for Pets; a Cattle's Session Sandbox lifecycle is destroyed automatically, so there is no Agent-level stable state to reset.

---

## 3. Goals

After this round, an admin should be able to:

- See, right after editing a field, the **highest Action tier** of the current edit and "what will happen" in the PendingChangesBanner at the top.
- See, at a glance at the top of the Apply Changes dialog, a green **"agent-state preserved"** badge (a reset shows a red ✗ "will be cleared").
- Know that Reset agent-state is only found under the Pet's Settings → Danger Zone, and requires type-to-confirm.
- See, in the dialog copy before doing a Reset, **what will not be cleared** (Profile / Skills / MCP refs / Space files / historical sessions / cost).

On the platform side, the following must hold:

- The 5-tier Action model is determined by the system based on the "highest tier affected by the change"; the admin does not pick it directly.
- The Runtime must provide three categories of backend capability — restart / recreate / reset — aligned one-to-one with the frontend's 5-tier semantics; reset-agent-state must be Pet-only.
- The 4 configuration tiers (restart-process / patch-and-restart / recreate-preserving-state / fork-agent) **preserve agent-state** by default; only the reset-agent-state tier wipes the Pet agent-state.
- M1B guarantees that the **session execution snapshot is immutable**: Apply Changes creates a new DeploymentVersion and affects new sessions; existing sessions do not silently swap configuration and do not follow the new version.
- **Caller perspective**: During the driver restart / sandbox recreate triggered by Apply Changes, every in-flight session connection receives an updating signal, and the caller UI shows an "Agent is updating" overlay; once the driver is ready, it continues using the session execution snapshot frozen at creation time (see §5 Flow A step 7).

---

## 4. Concept definitions

| Term                              | Product definition                                                                                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action                            | An operational action triggered by a single save. This PRD locks 5 tiers: `direct update` / `restart-process` / `patch-and-restart` / `recreate-preserving-state` / `fork-agent` / `reset-agent-state` (not config-triggered; it is an explicit Pet Danger Zone entry point). |
| agent-state                       | The user's mental umbrella term for a Pet's stable Agent Sandbox state, covering login state, cache, long-term local state, and native sessions. It is not a Space, and it must be preserved by default. A Cattle has no Agent-level stable state.                            |
| PendingChangesBanner              | The yellow bar at the top of the Agent detail page, shown when there are dirty fields; it computes the highest Action tier across fields and shows the corresponding copy plus Discard / Apply.                                                                               |
| LiveConfigActionDialog            | The second-level dialog triggered by Apply changes; it branches by Action kind (the five branches: restart-process / patch-and-restart / recreate-preserving-state / fork-agent / reset-agent-state STRONG_CONFIRM).                                                          |
| max-rank determination            | The system compares the configuration to be published against the current live configuration and takes the highest Action tier by per-field impact level.                                                                                                                     |
| agent-state preserved badge       | The green badge at the top of the dialog, with the copy "Your agent-state is preserved — login, cache, memory, and native sessions stay". Applied to all 4 configuration tiers.                                                                                               |
| agent-state will be cleared badge | The red ✗ badge at the top of the reset-agent-state dialog, in the same position as the line above but a different color, to anchor the contrast.                                                                                                                             |

### 4.1 Restart / Recreate / Reset — 5-tier frontend semantics table

Not every runtime environment change can be called a **reset sandbox**. For the user, the most critical question is "will my agent-state be preserved".

| User action                       | User understanding                                   | Typical trigger                                                                                   | agent-state preserved?                   | Frontend danger level                                                                             |
| --------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Restart driver / process          | Just restart the Agent process                       | Driver is stuck, or a restart is needed after a native config has been written                    | Yes                                      | Normal confirmation or direct execution                                                           |
| Patch native config + restart     | Apply the runtime's native config and restart        | OpenAI runtime / Claude / OpenCode native config patch                                            | Yes                                      | Normal confirmation                                                                               |
| Recreate sandbox preserving state | Swap in a clean container but restore the Agent home | Environment / container needs to be rebuilt, or the sandbox is damaged but state can be backed up | Yes                                      | Clearly state that there will be a brief unavailability                                           |
| Reset agent-state / factory reset | Wipe the Pet's stable Agent Sandbox state            | The Pet user explicitly wants to clear login state, cache, long-term memory, and native sessions  | No                                       | Pet-only danger confirmation; requires typing the Agent name or an equivalent strong confirmation |
| Fork Agent                        | Create a new Agent identity                          | Switching runtime after publishing, or the user wants to fork the service                         | No; the old state stays on the old Agent | New-creation path confirmation (see agent-service-identity §10 Flow C)                            |

Frontend copy principles:

- The default action must be a Restart or Recreate that preserves agent-state.
- `Reset` may only be used to wipe agent-state / factory reset; it must not be used for an ordinary restart or container rebuild.
- `Recreate sandbox` must carry `preserving state` or an equivalent note, to avoid users assuming data will be wiped.
- `Fork Agent` is not a reset. It creates a new bare-named Agent; the old sessions, logs, cost, and agent-state stay on the old Agent.
- Space files are not part of agent-state and must not appear in the deletion scope of reset agent-state.

---

> For the full engineering contract, see the full Runtime State Operations PRD.
