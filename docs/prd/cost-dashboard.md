# App Usage — current product contract

Status: active and shipped.

This document describes the cost surfaces that exist in the current Web and
GraphQL implementation. App is the primary product dimension. Organization is
retained as an authenticated billing rollup, not as the Web resource boundary.

See [App Boundary](./app-boundary.md).

## Product surface

App Usage is available at `/app-settings/usage`. `/cost`, `/usage`,
`/app-settings/cost`, and `/settings/cost` redirect to that route.

The header provides:

- purpose filters `All`, `Production`, and `Debug`;
- ranges `7d`, `30d`, `MTD`, and `90d`;
- a CSV export for the selected tab.

`Debug` is a Web grouping over the backend `debug` and `preview` purposes. `All`
submits no purpose filter, so it also includes recorded `channel`, `eval`, and
`scheduled` facts. Those backend purposes do not have separate Web filter
buttons.

### Overview

The Overview tab shows:

- Total Spend;
- Total Requests;
- Total Tokens, with cache-hit percentage as supporting text;
- Active Actors, with non-channel usage as supporting text;
- Daily spend;
- Top Agents;
- Spend by model.

It does not currently show recent usage rows, Agent health, Agent logs, or a
standalone unpriced-usage KPI. Those belong to other surfaces or remain visible
through model pricing state.

### By Agent

The By Agent tab shows owner, a two-segment production/debug run mix, change
from the previous period, requests, tokens, cache-hit percentage, spend, and
share of App spend. The mix visual includes `production` in its Production
segment and `debug + preview` in its Debug segment; `channel`, `eval`, and
`scheduled` usage still contributes to the row totals but is not represented by
that two-segment mix. Rows link to the Agent's Cost tab. Sorting supports cost
ascending/descending, request count, and largest spend increase.

### By Model

The By Model tab groups spend by model and vendor. It shows requests, tokens,
cache hit, configured input/output and cache prices, total cost, and whether
pricing needs attention. `Set pricing` links to Provider settings.

### Agent Cost tab

An Agent's Cost tab shows:

- Agent Spend, model calls, average input-plus-output tokens per call, and
  cache-hit percentage;
- `All`, `Production`, and `Debug` filters with the same grouping as App Usage;
- model usage and spend;
- recent usage rows with time, actor, model, tokens, cache-read tokens, and cost;
- CSV export and a link back to App Usage.

Recent usage is an Agent-scoped diagnostic. It is not present on the App
Overview tab.

## Data contract

The GraphQL cost contract exposes App, Agent, and Organization billing cards.
Each card reads the same normalized usage facts through its access boundary and
returns totals, daily points, and model groups; App and Agent cards also return
Agent attribution and recent usage rows where applicable.

Every card captures one request-time upper bound and evaluates a half-open
`[since, until)` window. The comparison period ends exactly at the current
period's `since`; current-period totals and recent usage never include events at
or after the request-time `until`. Detail events and daily rollups apply the same
boundaries. The atomic rollup batch adds old detail to the daily ledger and
deletes those source rows together, so queries can union both stores without a
gap or duplicate event. App Agent rows compare current spend with that same
previous-period window.
Rolling ranges compare with the immediately preceding `7d`, `30d`, or `90d`;
`MTD` compares with the preceding calendar month.
Detailed events are rolled up after seven days, and daily rollups retain 180
days so the current and previous `90d` periods remain queryable.

The persisted internal run-purpose enum is:

- `channel`;
- `production`;
- `debug`;
- `preview`;
- `scheduled`;
- `eval`.

The GraphQL `CostRunPurpose` input intentionally exposes five selectable values:
`production`, `debug`, `preview`, `scheduled`, and `eval`. `channel` is recorded
by channel producers and returned when the purpose filter is empty, but callers
cannot select it alone through the current GraphQL enum. The Web exposes only
All, Production, and Debug. Product documentation must not promise a separate
`channel`, `endpoint`, or other purpose filter until schema, queries, and Web
controls expose it.

Cost totals retain these token buckets:

```text
total_cost =
  billable_input_cost
  + output_cost
  + cache_read_cost
  + cache_creation_cost
```

Unknown pricing is not guessed. Model rows expose missing price fields and
unpriced request counts through the API; the Web model table turns that state
into a `Set pricing` action.

## Access and ownership

- App Usage requires ownership of the selected App.
- Agent Cost requires ownership of the Agent inside that App.
- Organization billing queries require ownership of that Organization.
- App and Agent identifiers are stored with usage facts and used as query
  dimensions; the Web does not infer them from display names.

## Explicitly not shipped on this surface

- health or log shortcuts;
- App-level recent Session rows;
- a standalone unpriced-usage KPI;
- separate scheduled, eval, channel, or endpoint filter controls;
- budget policy, invoices, finance exports, or per-person governance UI.

Future work may add those capabilities, but it is not part of the active/shipped
contract above.
