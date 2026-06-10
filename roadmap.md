# Mosoo Roadmap

This is a status snapshot, not a dependency graph. Items are grouped into three states so you can see where the work stands at a glance. Work that has been moved to post-mvp-polish or deferred outside this roadmap is not listed.

## 📋 Planned

- **Mosoo CLI** — authenticated managed-entity operations.
- **Version control** — versioning, including rollback.
- **Multi-vendor expansion** — support more runtime providers.
- **More access surfaces** — access via Linear, GitHub, and email.
- **Channel runtime** — Discord / WeChat live smoke / LINE.
- **Vendor subscription credential** — use model vendors through Claude Max / ChatGPT subscriptions.
- **Local / BYO runtime environment** — local / self-hosted runtime (under evaluation).
- **Session artifacts** — persist agent-generated files from sandbox sessions and expose them to API consumers, channels, and external users.
- **Overview / Quickstart** — workspace landing page (replacing agents as the first screen) combining quickstart and global analytics.

## 🛠️ In Development

- **Agent Builder** — formal PRD plus a controlled Draft patch.

## ✅ Done

- **Foundation** — session snapshot / lifecycle / runtime state operations.
- **Org Kind / CE Slots** — kind + slot enforced.
- **Agent page operations / runtime diagnostics** — Terminal, System Log, File Browser, Session Log, Runtime Logs.
- **Governance foundation** — RBAC trio + error message redaction.
- **Published API** — hardening plus the Public Thread API (`POST /threads`, `GET /threads/{id}`).
- **Provider readiness fallback UX** — missing-key / wrong-key states + vendor error pass-through.
- **Cost coverage**.
- **System Agent — community implementation** — Agent Builder configuration copilot.
- **Channels** — Slack / Lark / Telegram / Discord / WeChat owner setup + backend.
- **Pet / Cattle — core contract** — Manifest kind, Configure, Publish, Reset, Lock + Fork.
- **Cross-session Memory — runtime base** — Pet sandbox persistence.
- **Runtime environment** — remote cloud runtime.
