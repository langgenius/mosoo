# mosoo Spec

Status: canonical product contract for the current mosoo Alpha direction.

This document defines what mosoo is building and the boundaries it guarantees. It supersedes older App-hosting, Deployable Repo, Release, Workspace, and Organization-governance language whenever they disagree. Current product notes and code remain the authority for what is shipped today.

This Spec is deliberately narrower than a general-purpose application platform. Exact API schemas, manifest fields, quotas, and internal topology belong in implementation contracts.

## 1. Product Thesis

Coding agents are useful on a developer's machine. Turning one into a dependable product capability requires a runtime, isolated execution, durable work history, files, streaming events, provider credentials, permission handling, usage visibility, and an API that survives beyond one local session.

mosoo is an open-source runtime and control plane for configuring, running, and integrating coding agents. It normalizes OpenAI, Claude Agent SDK, and OpenCode execution behind one managed lifecycle while the Builder keeps ownership of the application, its business logic, and its end users.

The product loop is:

```text
Agent Manifest + Skills + MCP + provider credential
  -> Preview and publish an Agent version
  -> call the Agent from a trusted backend or the mosoo console
  -> isolated Run with streamed events and explicit permission requests
  -> durable Thread, files, outcomes, and usage records
```

mosoo's wedge is the managed coding-agent runtime and Agent API. It is not an AI app builder, a general workflow builder, an end-user identity service, or a promise to host an application's ordinary frontend and backend.

### Evidence status

- The current repository implements normalized runtime adapters, isolated Sandbox execution, durable Threads, Runs, events, files, Agent versions, and an App-owner API.
- Existing coding-agent tools solve local execution but leave product developers responsible for runtime integration and lifecycle infrastructure.
- mosoo has not yet proved production reliability, external adoption, or willingness to pay. Alpha validates the product hypothesis; it is not evidence of product-market fit.

## 2. Target User And Job

### Builder

A Builder configures a coding Agent in mosoo and integrates it into a product or automation. The Builder may be an independent developer, operator, or small internal-tools team, but is not expected to be an agent-runtime infrastructure specialist.

The Builder's job is:

> Make a coding Agent callable and operable from a product backend without owning its Sandbox, runtime adapters, durable work history, file pipeline, event stream, or usage instrumentation.

### App Owner

The App Owner is the Builder responsible for the mosoo App and its Agents. In Alpha, one mosoo Account owns an App. Team ownership, roles, invitations, and transfer are later extensions.

### End User

An End User may trigger Agent work through the Builder's product, but mosoo does not represent or authenticate that person today. The Builder's trusted backend enforces end-user access and maps its users to mosoo Threads.

### mosoo Account

A mosoo Account authenticates the Builder to the mosoo control plane. It is never reused as an End User identity. An Organization may remain an internal billing or tenancy shell, but it is not the business-user model of integrations.

## 3. Design Principles

1. **mosoo owns Agent execution, not the Builder's application.** Product code, business state, and end-user access remain with the Builder.
2. **One runtime contract spans supported agents.** Runtime-specific protocols are normalized before they reach product integrations.
3. **The Agent Manifest is the reproducible configuration.** Runtime, model, instructions, Skills, MCP connections, and Environment resolve from saved configuration rather than a developer's laptop.
4. **A Thread is the durable work boundary.** Messages, Runs, public events, and managed files remain addressable across individual executions.
5. **A Run is one observable execution.** Console and API entry points produce the same lifecycle records.
6. **Sandbox state is explicit.** Temporary execution state is not confused with durable Threads, files, Agent configuration, or bounded Assistant continuity.
7. **The public API is backend-to-backend.** App-owner tokens stay on trusted servers; mosoo does not claim App User authentication.
8. **High-impact side effects are mediated.** Permission requests and confirmation gates are enforceable runtime boundaries, not prompt conventions.
9. **Usage is observable, not billing truth.** Recorded model usage supports operational decisions without pretending to replace provider invoices.
10. **Do not broaden the product to hide missing proof.** App hosting, broad provider matrices, channels, governance, and recovery become promises only after their user-visible paths are proven.
