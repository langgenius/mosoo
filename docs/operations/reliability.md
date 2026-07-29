# Production Reliability

mosoo publishes production runtime health at
[mosoo.ai/status](https://mosoo.ai/status). This is a public SLO and measured
history, not a contractual SLA.

## Synthetic Canary

Every five minutes, the website Worker calls the production Public API for each
public runtime:

1. Start a dedicated Thread with a cheap deterministic prompt.
2. Require assistant output and a completed Run within that target's TTFT
   budget.
3. Wait six seconds, then send a follow-up through the same Thread.
4. Require the follow-up within budget and verify both Runs used the same
   driver.
5. Delete the canary Thread and publish only timings, pass/fail state, and daily
   counts to `/status.json`.

The monitored runtimes are OpenAI Codex (`openai-runtime`), Claude Agent SDK
(`claude-agent-sdk`), and OpenCode (`acp-fallback`). Missing two scheduled
intervals makes the component `unknown`; a shallow health ping never counts as
a passing check.

## SLO And Error Budget

The target is **99.5% passing canary checks over a rolling 30-day window**. A
check passes only when both turns meet the configured TTFT budget and the
follow-up reuses the first turn's driver.

If any runtime breaches the check three consecutive times, feature releases
freeze. Until a passing canary and incident review clear the freeze, the team
ships reliability fixes only. A customer-visible production failure triggers
the same rule even before the third canary breach.

## Production Activation

Create one dedicated, published canary Agent per runtime under a dedicated
service account. Store the shared diagnostic secret in both Workers, and store
the PAT plus Agent IDs only in the website Worker:

```bash
# From the mosoo repository:
cd apps/api
../../node_modules/.bin/vp exec wrangler secret put MOSOO_STATUS_CANARY_SECRET --env prod

# From the mosoo-website repository:
npx --yes --package wrangler@4.115.0 wrangler secret put STATUS_CANARY_SECRET --env prod
npx --yes --package wrangler@4.115.0 wrangler secret put STATUS_CANARY_TARGETS --env prod
```

`STATUS_CANARY_TARGETS` is one secret JSON value:

```json
{
  "token": "<dedicated-personal-access-token>",
  "targets": [
    {
      "id": "openai-runtime",
      "agentId": "<agent-ulid>",
      "ttftBudgetMs": 20000
    },
    {
      "id": "claude-agent-sdk",
      "agentId": "<agent-ulid>",
      "ttftBudgetMs": 20000
    },
    {
      "id": "acp-fallback",
      "agentId": "<agent-ulid>",
      "ttftBudgetMs": 20000
    }
  ]
}
```

Never commit either secret. After both Workers are deployed, verify
`https://mosoo.ai/status.json` records all three components and that a second
turn reports `driverReused: true`.

## Incident Discipline

Open an incident when a canary reaches the freeze threshold, production
failures affect users, or the status feed is stale for more than two intervals.
Publish the timeline and customer impact while investigating. After recovery,
archive a postmortem using
[the incident template](./incidents/README.md) before normal feature releases
resume.
