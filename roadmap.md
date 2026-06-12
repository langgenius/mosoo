# Mosoo Roadmap

This is a status snapshot, not a dependency graph. Items are grouped by state so you can see where the work stands at a glance. Work that has been moved to post-mvp-polish or deferred outside this roadmap is not listed.

## Current Construction Lock

The current pivot is Project/App separation under a single-owner Organization assumption. Organization remains the account / billing / tenant shell; Project is the code and data boundary; App is the console noun.

Near-term construction order:

1. Project model, contracts, GraphQL, and default Project/App provisioning.
2. Agent ownership under Project, with Threads / Sessions inheriting Project from Agent.
3. Environment and Provider defaults under Project, with Organization fallback only as migration bridge.
4. MCP, Skills, Spaces, deployment state, and app-scoped usage/cost under Project/App.
5. App Overview as the console root; one-App Organizations route directly into the App.

Project members, org-wide shared libraries, role matrices, and enterprise governance are outside this phase.

## 📋 Planned

- **Mosoo CLI** — authenticated managed-entity operations.
- **Multi-vendor expansion (July 2026)** — support more runtime providers.
- **More access surfaces** — access via Linear, GitHub, and email.
- **Channel runtime** — Telegram / Discord / WeChat live smoke / LINE.
- **Local / BYO runtime environment** — local / self-hosted runtime (under evaluation).
- **Session artifacts** — persist agent-generated files from sandbox sessions and expose them to API consumers, channels, and external users.
- **Overview / Quickstart** — App landing page (replacing Agents as the first screen for the one-App path) combining quickstart, deployment health, and app-local analytics.

## 🛠️ In Development

- **Project / App separation** — canonical Project model with App console copy, default App provisioning, Project-owned resources, and App Overview routing. See [Project / App Boundary](./dev/prd/project-app-boundary.md).
- **Agent Builder** — formal PRD plus a controlled Draft patch, subordinate to the Project/App resource boundary.

## 🔮 Future

- **Cross-session Memory** — Pet sandbox persistence; runtime base shipped, broader feature deferred.

## ✅ Done

- **Foundation** — session snapshot / lifecycle / runtime state operations.
- **Agent page operations / runtime diagnostics** — Terminal, Session Log.
- **Governance foundation** — RBAC trio + error message redaction; multi-member governance is historical foundation / future extension, not part of the current single-owner Project/App cut.
- **Published API** — hardening plus the Public Thread API (`POST /threads`, `GET /threads/{id}`).
- **Provider readiness fallback UX** — missing-key / wrong-key states + vendor error pass-through.
- **Cost coverage**.
- **System Agent — community implementation** — Agent Builder configuration copilot.
- **Channels** — Slack / Lark / Telegram / Discord / WeChat owner setup + backend.
- **Pet / Cattle — core contract** — Manifest kind, Configure, Publish, Reset, Lock + Fork.
- **Runtime environment** — remote cloud runtime.
