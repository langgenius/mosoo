# Production Reliability

Mosoo publishes observed production health at
[mosoo.ai/status](https://mosoo.ai/status). The page is descriptive telemetry,
not a contractual SLA or a synthetic SLO.

## Signals

The status pipeline reuses two production signals:

1. Cloudflare Tail Worker events report every `mosoo-api-prod` invocation
   outcome and HTTP 5xx response. The API's existing one-minute maintenance
   schedule supplies an idle-traffic liveness signal without calling a model.
2. Mosoo's shared Run lifecycle emits one structured `session.run.terminal`
   business log when it commits a terminal transition. The log contains the
   runtime, terminal status, duration, error code, Run ID, and trace ID; it does
   not contain prompts, model output, user IDs, or account IDs.

`mosoo-website-prod` consumes those Tail events and rolls up 90 days of daily
counts in the existing `StatusStore` Durable Object. It never creates a Thread,
invokes an Agent, or consumes model tokens.

## Public Measurements

- **Service availability** is the share of observed API Worker invocations that
  finish without a severe Worker outcome or HTTP 5xx response.
- **Runtime Run completion rate** is `completed / (completed + failed +
expired)` for real `ui` and `api_channel` Runs. Preview Runs and cancellations
  are excluded.
- The API/control-plane signal becomes `unknown` after five minutes without a
  Tail event. A runtime becomes `unknown` after 24 hours without a real Run;
  the page does not manufacture traffic to keep it green.

A failed API invocation is shown immediately. A runtime becomes `degraded`
after three consecutive observed Run failures; earlier failures remain visible
in its completion rate and latest error code. Three consecutive failures also
set `releasePolicyTriggered` in `/status.json` for release review.

## Deployment And Verification

Deploy `mosoo-website-prod` first so its `tail()` handler is available, then
deploy `mosoo-api-prod`, whose Wrangler configuration names the website Worker
as a Tail consumer. No status-specific secrets are required.

Verify that `https://mosoo.ai/status.json` reports `version: 2`, receives a fresh
platform observation within five minutes, and updates the matching runtime only
after a real user-facing Run reaches a terminal state.

## Incident Discipline

Open an incident when production failures affect users, the failure threshold
is reached, or the platform feed stays stale. Publish customer impact and the
timeline while investigating, then archive a postmortem using
[the incident template](./incidents/README.md) before normal feature releases
resume.
