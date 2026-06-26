# App Usage - for humans

> This is the product-story version for non-engineering readers. The engineering
> contract follows the boundary in `docs/SPEC.md`: usage is recorded with
> App as the primary business dimension, while Organization remains a
> billing rollup and future governance shell.
>
> See [App Boundary](./app-boundary.md).

---

## One-line positioning

Give the App owner one place to understand how an App is spending money: total
spend, requests, tokens, cache behavior, model mix, Agent contribution, recent
Session Runs, health, logs, and unpriced usage.

The product shape is closer to a small App-local Cost Explorer than a tenant-wide
finance console. The same cost facts can later roll up for billing, but V1 starts
where the user works: inside the App.

---

## 1. The user problem

An App can run multiple Agents, expose Agent API Endpoints, open Threads, and
receive channel-triggered runs. Without an App Usage view, the owner can see a
bill after the fact but cannot answer the operational questions that change
behavior:

- _"Which Agent or Session Run drove the spike this week?"_
- _"Did cost rise because request volume changed, or because the model mix changed?"_
- _"Did a prompt change break cache reuse?"_
- _"Which model/provider is unpriced and therefore missing dollar attribution?"_
- _"Are preview/debug runs distorting what looks like production demand?"_

The missing boundary is not a person-reporting problem. It is an App operations
problem: cost must be legible at App, Agent, Session Run, model/provider, trigger,
and purpose level.

---

## 2. Goals

### App Usage

- Show App-level KPIs for spend, requests, tokens, cache usage, model/provider
  mix, recent runs, health, logs, and unpriced usage count.
- Let the App owner drill from App total to Agent contribution and then to recent
  Session Runs without leaving the App context.
- Treat preview, debug, scheduled, channel, eval, and endpoint-triggered runs as
  filterable run purposes on the same App ledger.
- Keep the primary business dimension App for every cost fact.
- Preserve Organization only as a billing rollup so later billing operations can
  aggregate Apps without becoming the product access boundary.

### Agent Cost Tab

- Show Agent-scoped spend, run count, average tokens per run, cache hit
  percentage, model/provider mix, and recent Session Runs.
- Make cache regressions visible enough that an owner can connect a cost spike to
  a prompt or manifest change.
- Keep Agent cost diagnostics subordinate to the active App; the tab must not
  become a second tenant-wide cost surface.

### Ledger

- Record each normalized provider/runtime usage event exactly once.
- Never derive App ownership from old runtime identifiers or historical package
  labels. If a usage event cannot prove its App, reject it or mark it
  unpriced/unattributed at App ingestion time.
- Do not create a compatibility layer that maps old tenant-level resource
  assumptions into current App access.

---

## 3. Concept definitions

| Term                            | Definition                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cost Fact**                   | A single normalized runtime/provider usage event recorded exactly once. Dashboards filter and group the same fact; they do not duplicate it.        |
| **App Usage**                   | The primary V1 product surface for cost, requests, tokens, cache behavior, model/provider mix, recent runs, health, logs, and unpriced usage.       |
| **Organization Billing Rollup** | A billing aggregation over Apps. It exists for account and invoice semantics, not as a user-visible resource or permission boundary in V1.          |
| **Run Purpose**                 | The App-local source label for a Session Run, such as production, debug, preview, scheduled, channel, eval, or endpoint-triggered.                  |
| **Agent Cost Tab**              | A diagnostic view nested under one Agent in the active App. It explains that Agent's contribution to App usage.                                     |
| **Cache-adjusted**              | Billing deducts cache-read input from base input before charging the base input price, then adds cache-read and cache-creation prices separately.   |
| **Cache Hit %**                 | The health metric for prompt-prefix reuse. A sudden drop for the same Agent often points to a prompt or manifest change.                            |
| **Unknown pricing**             | Usage for a model/provider with no pricing record. The usage remains visible and contributes to the unpriced count, but dollar cost is not guessed. |
| **Cost Service**                | The service that accepts normalized usage, writes App cost facts, and exposes App and billing-rollup queries.                               |

---

## 4. Entry points

### App Usage surface

The current Web console routes App usage through `/settings/usage` (rendered
inside the Settings shell as the **App usage** tab); `/cost`, `/usage`, and the
legacy `/settings/cost` path all redirect there. The page belongs to the active
App context and has a unified header:

- Period switcher: `7d`, `30d`, `MTD`, `90d`.
- KPI strip: spend, requests, tokens, cache usage, unpriced usage.
- Overview: 30-day spend bars, top Agents, model/provider breakdown, recent runs,
  health and log shortcuts.
- Agents: sortable Agent contribution with run mix, trend, spend, and cache hit.
- Models: provider/model spend, token buckets, cache behavior, and pricing state.

### Agent detail Cost tab

The Agent tab answers: _"How is this Agent contributing to App usage?"_

- Scoped KPIs: Agent spend, runs, average tokens per run, cache hit.
- Purpose filter: production, debug, preview, scheduled, channel, eval, endpoint.
- Model usage: whether a run used the intended model/provider or resolved a
  different runtime model.
- Recent Session Runs: run id, purpose, trigger, tokens, cache buckets, cost, and
  pricing state.
- Link back to the App Usage overview, not to a tenant-wide cost console.

### Billing rollup

Organization rollup is retained for invoice/account aggregation and future
governance. It should consume App cost facts after they are written; it should not
be the first surface a product user opens, and it should not own resource access.

---

## 5. Attribution model

| Run source                              | Counts toward App usage? | Primary dimension | Secondary drilldown        | Run purpose           |
| --------------------------------------- | ------------------------ | ----------------- | -------------------------- | --------------------- |
| Web Thread targeting an Agent           | Yes                      | App       | Agent, Thread, Session Run | production or debug   |
| Agent API Endpoint request              | Yes                      | App       | Agent, endpoint, run       | endpoint              |
| Draft or preview execution              | Yes                      | App       | Agent, draft, run          | preview or debug      |
| Scheduled execution                     | Yes                      | App       | Agent, schedule, run       | scheduled             |
| Channel-triggered execution             | Yes                      | App       | Agent, channel, run        | channel               |
| Evaluation or readiness run             | Yes                      | App       | Agent, eval batch, run     | eval                  |
| Event with missing App evidence | No                       | Rejected          | Error record               | ingestion-fail-closed |

**Invariants**:

1. App attribution is immutable after the cost fact is written. Later Agent edits,
   endpoint changes, or package exports must not rewrite historical App usage.
2. Agent, Thread, Session Run, model/provider, trigger, and purpose are drilldown
   dimensions over the same fact. They are not separate ledgers.
3. Runtime/package ids that cannot prove App ownership fail closed. V1
   must not infer ownership from legacy snapshots.

---

## 6. Cost calculation

The USD shown in App Usage comes from four token buckets:

```text
total_cost =
  billable_input_cost
  + output_cost
  + cache_read_cost
  + cache_creation_cost
```

`billable_input_cost` is calculated from input tokens that did not hit the prompt
cache. Cache-read tokens are charged using the cache-read price, not charged
again at the base input price.

Every visible cost view should expose enough formula detail for a user to trust
that cache reuse is priced correctly. The UI can summarize this, but the backend
must remain the single interpreter of provider token semantics and pricing.

### Unknown pricing

The dashboard never drops usage for an unknown model/provider. It shows:

- unpriced usage count;
- affected model/provider;
- tokens and request counts;
- recent runs that produced the usage.

The frontend displays the pricing state it receives. It does not reinterpret
price tables or guess dollar cost.

---

## 7. User journeys

### A. App owner reviews the month

| Stage      | Action                                             | What they see                                                      |
| ---------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| 1 Trigger  | Opens App Usage at month end                       | Spend, requests, tokens, cache usage, and unpriced usage count     |
| 2 Overview | Checks the 30-day trend and model/provider mix     | A spike tied to one support Agent and one expensive model          |
| 3 Drill in | Opens the Agent contribution row                   | Run mix shows preview/debug traffic grew faster than production    |
| 4 Verify   | Opens recent Session Runs                          | Token buckets and cache state explain which runs changed the curve |
| 5 Act      | Opens Agent configuration, logs, or health context | Owner can tune the Agent without leaving the App boundary          |

### B. Cache-hit anomaly

1. The owner notices an Agent's spend doubled this week.
2. The Agent Cost tab shows Cache Hit % dropped from 78% to 12%.
3. Recent Session Runs show similar request volume but larger billable input.
4. Manifest history shows the prompt prefix changed yesterday.
5. The owner rolls back or edits the prompt, and cache hit recovers.

### C. Unpriced model investigation

1. App Usage shows `unpriced usage: 18`.
2. The Models view groups the usage under one model/provider pair.
3. Recent runs identify the Agent and endpoint that selected the model.
4. Billing operations can backfill pricing later; the product view already made
   the operational source visible.

### D. Channel cost as an App run purpose

1. App Usage shows channel-triggered runs as one filterable purpose.
2. The owner drills into the Agent and channel that generated the spend.
3. The cost stays attached to the App and Agent, with channel as trigger context.
4. There is no separate person-row footer or alternate ledger in V1.

---

## 8. Future governance

Future governance can add tenant finance dashboards, human-actor drilldowns,
budget policy, exports for finance teams, and per-person credential policy. Those
surfaces must consume App cost facts after the App ledger is correct; they must
not reintroduce Organization as the resource boundary for V1.
