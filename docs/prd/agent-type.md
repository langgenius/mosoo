# Agent Type

Status: available in the current Agent Preview flow.

## Why this matters

mosoo supports two Agent types because users need different kinds of continuity. Some Agents should feel like ongoing teammates; others should start each job cleanly so unrelated work does not share temporary state. The App owner chooses the type based on that user expectation, not on the model or provider.

## The two choices

- **Assistant Agent** keeps a stable working environment across sessions. It suits daily helpers, knowledge assistants, and copilots that benefit from ongoing context. Sessions may share local working state, so it is not the right choice when every job must be isolated. Continuity is bounded: a rebuild preserves selected memory and workspace content, but may lose local sign-ins, caches, or tool-specific state.
- **Task Agent** starts with a clean working environment for each run and releases it when the run ends. It suits PR reviews, ticket triage, webhooks, and batch work. Conversation records remain visible, but temporary working state does not carry into the next run. Users must attach any files needed again.

## User flow

1. The App owner creates an Agent by choosing a name and runtime. New Agents start as Assistant Agents.
2. In Preview, the owner can compare the two types, switch freely, and test the Agent before publishing.
3. The first Publish locks the type. This prevents an existing Agent from silently changing its continuity and isolation behavior.
4. To change type later, the owner forks the Agent into a new draft. Reusable configuration carries over; existing sessions, cost history, logs, and working state stay with the original Agent.

## Current product boundary

Type selection, locking, forking, and type-specific working environments are available today. Owners can open a Terminal and reset working state for Assistant Agents; Task Agents do not show those controls. Both types otherwise use the same Preview, publishing, conversation, logs, and cost surfaces. Agents remain capabilities inside an App, not standalone products.
