# Agent Work History

Status: durable history is available in Alpha. Project-direct invocation and optional Agent presets are implemented in the unreleased #582 candidate; hosted acceptance, Cloud migration and coordinated release remain open. See the [mosoo Spec](../SPEC.md).

## Why It Exists

Agent work can begin in the mosoo console or through a developer integration. Without one durable history, requests, follow-ups, results, and failures would be scattered across those entry points.

mosoo keeps each interaction as a record of work. This lets a Project owner understand what happened, return later, and continue when appropriate without needing to understand the temporary execution environment behind the Agent.

## Who It Is For

Builders and Project owners use this history directly to start, monitor, and revisit Agent work. Developer integrations benefit from the same continuity without needing a mosoo console account for every interaction.

## Candidate experience

- A backend supplies a Project key, harness, provider, model, instructions, input and optional files to start a durable Session. Saving or publishing an Agent is not required.
- An owned Agent is an optional reusable preset. New Sessions freeze the selected configuration; later preset edits do not change admitted work.
- mosoo shows the request, responses, work status, and available process or file activity.
- The owner can add a follow-up, archive completed work, or delete it.
- The same Session can receive follow-up input after its execution resource is reclaimed, retaining its committed native context and working files.

The deployed v1 Agent endpoint retains its existing publication and identity requirements. That compatibility path does not define the direct v2 prerequisite.

## Current Boundaries

The current console still calls this history a **Thread** in several screens while the main navigation is moving toward **Runs**. Treat these as views of Agent work, not separate products.

Each record belongs to one Project. Its Agent reference is optional provenance. The admitted settings, native conversation and committed workspace belong to the Session; the Sandbox and Driver are replaceable execution resources. Live processes and network connections do not survive reclamation.

Local HTTP and database tests establish admission and configuration boundaries. Completing #582 also requires real zero-Agent harness execution, independently verified files, same-ID cold and delayed continuation, protected Cloud migration and release. Removing Publish or passing a saved-Agent run does not satisfy that acceptance.
