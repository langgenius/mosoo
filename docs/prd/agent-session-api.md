# Agent Work History

Status: implemented foundation in Alpha. [Mosoo Spec](../SPEC.md) defines the launch direction.

## Why It Exists

Agent work can begin in the Mosoo console or through a developer integration. Without one durable history, requests, follow-ups, results, and failures would be scattered across those entry points.

Mosoo keeps each interaction as a record of work. This lets an App owner understand what happened, return later, and continue when appropriate without needing to understand the temporary execution environment behind the Agent.

## Who It Is For

Builders and App owners use this history directly to start, monitor, and revisit Agent work. Developer integrations benefit from the same continuity without needing a Mosoo console account for every interaction.

## Experience Today

- In the console, an owner chooses a published Agent, describes the desired outcome, and may attach files.
- Mosoo shows the request, Agent responses, work status, and available process or file activity.
- The owner can add a follow-up, archive completed work, or delete it.
- A published Agent's developer integration can create, read, list, and continue work.

## Current Boundaries

The current console still calls this history a **Thread** in several screens while the main navigation is moving toward **Runs**. Treat these as views of Agent work, not separate products.

Each record belongs to one App and one Agent. The Agent version and settings selected when it starts remain attached to that history. Recorded messages and managed files are durable; temporary processes and unrecorded files are not.

These paths exist in the current repository and have automated coverage, but Mosoo remains in Alpha. Production reliability and external adoption have not yet been proven. Channel delivery exists in code but is not currently a reachable end-to-end user feature; see [Channels](./channels.md).
