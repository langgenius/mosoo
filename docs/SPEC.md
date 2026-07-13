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
