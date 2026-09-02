# 2026-07-29 — OpenAI Runtime Runs Unavailable

- Status: Resolved
- Severity: SEV-2
- Window: 2026-07-29 16:31–20:37 UTC
- Affected surface: OpenAI runtime
- Public status update: https://mosoo.ai/status
- Tracking PRs:
  [#455](https://github.com/langgenius/mosoo/pull/455),
  [#456](https://github.com/langgenius/mosoo/pull/456),
  [#457](https://github.com/langgenius/mosoo/pull/457),
  [#458](https://github.com/langgenius/mosoo/pull/458), and
  [#459](https://github.com/langgenius/mosoo/pull/459)

## Summary And Impact

OpenAI Runtime users could submit a Run, but it failed before producing an
assistant response. Depending on which release and sandbox state served the
Run, users saw an inactive runtime, an OpenAI authentication failure, a generic
502, or a runtime lifecycle maintenance error. Other runtime providers were not
part of the confirmed impact.

The number of affected users is unknown because the public production canary
had not been activated. A user report first confirmed impact at 17:46 UTC.

## Timeline

- 16:31 — A production release enabled HTTPS interception for every sandbox.
- 17:46 — A user report confirmed OpenAI Runtime Runs were failing.
- 19:02 — HTTPS interception was limited to restricted-network sandboxes;
  runtime startup recovered.
- 19:37 — Codex app-server was configured to send OpenAI traffic through the
  mosoo LLM proxy.
- 20:06 — Safe upstream failure logging reached production.
- 20:08 — Production logs identified a Cloudflare-incompatible Fetch redirect
  mode before any request reached OpenAI.
- 20:18 — The proxy redirect fix reached production.
- 20:27 — The checkpoint-directory repair reached production.
- 20:34 — The affected Agent's sandbox automatically recovered from lifecycle
  maintenance.
- 20:37 — Recovery was confirmed by two successful production Runs on the
  affected OpenAI Agent, including same-driver follow-up reuse.

## Root Cause

The incident combined four gaps along one production-only path:

1. HTTPS interception was enabled for full-network sandboxes even though those
   sandboxes did not receive an interception certificate, so the container
   refused to start.
2. Codex app-server requires `openai_base_url` configuration and does not use
   the provisioned environment variable, so the mosoo proxy grant was sent to
   OpenAI as if it were an OpenAI key.
3. The proxy used `redirect: "error"`. Bun accepted that mode, but Cloudflare
   Workers rejects it before issuing the upstream request.
4. Failed Runs left some pet sandboxes with stale session workspace records.
   A missing workspace then made every checkpoint retry fail, keeping the
   entire Agent in lifecycle maintenance.

Unit and repository checks covered each component in isolation, but no active
production canary exercised the complete OpenAI path through container startup,
Codex app-server configuration, the Worker proxy, and sandbox recycling.

## Detection And Response

The incident was detected by a user report rather than the status surface.
Production container logs identified the startup failure; a real OpenAI Run and
temporary safe error logging then isolated the proxy failures. The status feed
remained `unknown` because its production canary credentials and targets were
not configured, which delayed detection and left the release freeze dependent
on manual evidence.

## Corrective Actions

- [x] Runtime team — enable HTTPS interception only for limited-network
      sandboxes — 2026-07-29
- [x] Runtime team — configure Codex app-server with the mosoo OpenAI proxy —
      2026-07-29
- [x] Runtime team — use the Cloudflare-supported manual redirect mode and keep
      sanitized upstream failure logging — 2026-07-29
- [x] Runtime team — make checkpoint targets exist before backup so stale
      workspaces cannot wedge an Agent — 2026-07-29
- [ ] Runtime team — activate all three public production canaries and verify
      `/status.json` records real Runs — 2026-08-03
- [ ] Runtime team — add a Worker-runtime proxy smoke test to catch platform
      Fetch differences before deployment — 2026-08-07

## Lessons

Passing unit tests did not prove the production runtime path because Bun and
Cloudflare implement different redirect modes, and the Driver's OpenAI
configuration contract differs from ordinary environment-based SDKs. A release
that changes sandbox boot or provider routing needs a real production Run as
its acceptance check. The public status page also needs an active canary; an
unconfigured `unknown` feed is not incident detection.
