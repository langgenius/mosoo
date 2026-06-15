# Mosoo Roadmap

This is a status snapshot, not a dependency graph. Items are grouped by state so you can see where the work stands at a glance. Work that has been moved to post-mvp-polish or deferred outside this roadmap is not listed.

## Current Construction Lock

The current pivot is App boundary consolidation under a single-owner Organization assumption. Organization remains the account / billing / tenant shell; App is the code, data, console, and Agent capability package boundary.

Near-term construction order:

1. App model, contracts, GraphQL, and default App provisioning.
2. Agent ownership under App, with Threads / Sessions inheriting App from Agent.
3. Environment and Provider defaults under App, with no Organization fallback.
4. MCP, Skills, Spaces, Channels, Agent exposure state, export, and app-scoped usage/cost under App.
5. App Overview as the console root; one-App Organizations route directly into the App.

Role matrices, cross-account resource catalogs, and enterprise governance are outside this phase.

## 📋 Planned

- **Mosoo CLI** — authenticated managed-entity operations.
- **Multi-vendor expansion (July 2026)** — support more runtime providers.
- **More access surfaces** — access via Linear, GitHub, and email.
- **Channel runtime** — Telegram / Discord / WeChat live smoke / LINE.
- **Local / BYO runtime environment** — local / self-hosted runtime (under evaluation).
- **Session artifacts** — persist agent-generated files from sandbox sessions and expose them to API consumers, channels, and external users.
- **Overview / Quickstart** — App landing page (replacing Agents as the first screen for the one-App path) combining quickstart, Agent exposure health, export, and app-local analytics.

## 🛠️ In Development

- **App boundary consolidation** — canonical App model, default App provisioning, App-owned resources, and App Overview routing. See [App Boundary](./docs/prd/app-boundary.md).
- **Agent Builder** — formal PRD plus a controlled Draft patch, subordinate to the App resource boundary.

## 🔮 Future

- **Cross-session Memory** — Pet sandbox persistence; runtime base shipped, broader feature deferred.

## ✅ Done

- **Foundation** — session snapshot / lifecycle / runtime state operations.
- **Agent page operations / runtime diagnostics** — Terminal, Session Log.
- **Historical governance cleanup** — legacy role/error surfaces are no longer part of the current single-owner App cut.
- **Published API** — hardening plus the Public Thread API (`POST /threads`, `GET /threads/{id}`).
- **Provider readiness fallback UX** — missing-key / wrong-key states + vendor error pass-through.
- **Cost coverage**.
- **System Agent — community implementation** — Agent Builder configuration copilot.
- **Channels** — Slack / Lark / Telegram / Discord / WeChat owner setup + backend.
- **Pet / Cattle — core contract** — Manifest kind, Configure, Publish, Reset, Lock + Fork.
- **Runtime environment** — remote cloud runtime.
