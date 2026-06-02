# Cost Dashboard — for human

> This is the product-story version for non-engineering readers. The **complete engineering contract** (ledger semantics, attribution tables, cost formulas, unknown-pricing handling, rollup strategy, role-gating implementation) lives in the full shipped PRD.

---

## One-line positioning

Give a Mosoo Organization a dashboard that can answer "**who is spending money**." Three entry points, three audiences: admins audit the whole organization, Agent owners explain their own Agent's spend, and individual members self-serve "how much did I use."

An analogy: it compresses the product shape of AWS Cost Explorer down onto a single Agent runtime — the same cost facts, viewed through four dimensions: **Organization / Agent / member / model**.

---

## 1. The user problem

Today a Mosoo Organization is completely blind to "who is spending money." Every LLM call goes through the organization's own provider credential, but the only place you can see token counts is the per-session log — so an admin can't answer any of these questions:

- _"Which Agent / which Agent owner burned the most this month?"_
- _"Which member is pushing the curve up?"_
- _"Was this money spent on real usage, or by builders debugging unpublished Agents?"_
- _"Is Claude Opus 4.7 really worth 48% of the bill?"_
- _"I want to compile my own consumption into an expense report — where do I look?"_

Ordinary members can't self-serve the answer either: "How much did **I** use this month?"

---

## 2. Goals

After ship, each of the three user types can do the following:

### Admin

- A dedicated top-level entry point `/cost` with four tabs (Overview / By Agent / By User / By Model) that answer cross-Agent, cross-member, and cross-model budget questions
- See, at a glance, four KPIs — Total Spend / Requests / Tokens / Active Users — compared against the previous period
- In the By Agent / By User tables, **sort by column and scan for runaway cost by color** (ember for increases, green-700 for decreases)
- Export CSV from all three views, so there is hard data to bring to a conversation with finance

### Agent owner

- Open their own Agent detail page → Cost tab to answer "who is running my Agent, with which model, and how much did it cost me"
- See **leading signals** like Cache Hit — when cache hit drops, it often means someone changed the system prompt and broke the prefix match

### Ordinary member

- Open `Settings → Usage` to self-serve "how much did I use / how much did the Agents I built burn," without bothering an admin
- The UI uses warm brown (`--soil`) instead of the admin view's green, a visual cue that "this is **your** data, not the organization's"

---

## 3. Concept definitions

| Term                                 | Definition                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cost Fact**                        | A single real runtime / provider usage event enters the ledger exactly once. Different dashboards merely interpret the same fact along different dimensions; there is **no double-counting**                                                                                                                                                                      |
| **Used by (usage attribution)**      | How much usage / cost this member triggered **as a consumer** — answers "who is spending money using Agents"                                                                                                                                                                                                                                                      |
| **Owned by (ownership attribution)** | How much cost was produced by Agents under this member **as their Agent owner / developer** — answers "whose developed and maintained Agents are consuming budget"                                                                                                                                                                                                |
| **Run scenario**                     | The source label for a single Agent run: production / debug / preview / scheduled / channel (all five count toward the Organization total, but can be filtered individually)                                                                                                                                                                                      |
| **Channel-triggered**                | Triggered by an external user from an external collaboration platform such as Slack / Discord / Lark. For these calls the Agent owner is still in this organization, but the **Actor is an external user** — these do not land in any member row of the By User tab; instead they go into a separate footer row at the bottom. See [`channels.md`](./channels.md) |
| **Cache-adjusted**                   | When billing, input tokens that already hit the prompt cache are deducted from base input, so cache-read tokens aren't charged again at the base input price                                                                                                                                                                                                      |
| **Cache Hit %**                      | The health metric for whether the system prompt is being reused correctly. A sudden drop in cache hit for the same Agent → very likely someone changed the system prompt and broke the prefix match                                                                                                                                                               |
| **Unknown pricing**                  | When a model appears for which the dashboard has no pricing record, **usage is not lost** — the dashboard shows this unpriced usage and gives the admin a way to backfill the pricing                                                                                                                                                                             |
| **Cost Service**                     | The cost service behind the dashboard. It only accepts already-normalized usage; it does not guess the field semantics of different providers                                                                                                                                                                                                                     |

---

## 4. The three entry points (product story)

### ① `/cost` (top-level navigation) · for admins

Four tabs with a unified header: **title + period switcher (7d / 30d / MTD / 90d) + Export CSV**.

| Tab          | Question it answers                                                                           | Key presentation                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Overview** | How much was spent in this period? Who is contributing?                                       | 4 KPIs + 30-day bar chart + Top Agents + Top Users + Spend by model donut                          |
| **By Agent** | Which Agent is burning? Who is the owner? Is it production or debug driving the cost?         | Sortable table: Owner / Run mix / Trend 30d sparkbar / vs. Prev / Cost + share                     |
| **By User**  | Who is using it / whose developed Agents are burning? How much is external channel-triggered? | Sortable table + toggle between Used by / Owned by modes + External channel-triggered footer       |
| **By Model** | Where is the money going by model / by provider? Is this model expensive?                     | Donut + By vendor horizontal bars + pricing table (list price per 1M tokens · cache hit % · share) |

Why not merge ① and ②? An admin's audit needs (cross-Agent, cross-member) and an Agent owner's diagnostic needs ("who is using my Agent") are **two different shapes of data** — force them together and the second need gets hidden.

Why not stuff ① into Settings? A four-tab, data-dense dashboard won't fit into the 220px Settings sidebar. It deserves a dedicated top-level entry point, just like `Providers`.

**Role gating**: `/cost` is visible only to organization admins; a non-admin who hits the URL directly sees an "Admins only" empty state that points them to _Settings → Usage_.

### ② Agent detail page → Cost tab · for Agent owners

The owner wants to answer: "**Who is running my Agent, with which model, and how much did it cost me?**"

- Scoped KPIs: Agent Spend / Runs / Avg Tokens per Run / **Cache Hit**
- A `production / debug / preview / scheduled` filter in the top-right corner
- Two columns: **Who is running this Agent** (session counts by member) + **Model usage** (whether the default model is pinned, or whether it fell back to something else)
- A Recent sessions list at the bottom showing the most recent 5 runs (member + tokens + cost), without having to switch to the Logs tab
- A top-right link, `Open Organization Cost` — admins can always jump back to the global view from the Agent view in one click

### ③ Settings → Usage · for every member

Every member sees themselves. The default is **Used by me**: how much I triggered as a consumer. If this member owns Agents, an **Owned by me** section also appears: how much the Agents under me as their owner produced. The two are **different attributions of the same set of usage events, and are not additive**.

Deliberately simpler than the admin view:

- 3 KPIs instead of 4 (no "Active Users" — meaningless at n=1)
- The accent color is warm brown (`--soil`) instead of green — this is _your_ data, not the organization's
- An "Agents I use most" ranking, each row annotated with "what share of my own usage"
- "My owned agents" appears only when the member owns Agents
- A one-line footnote: "Admins can open the Cost dashboard" — telling members the admin view exists, without making it feel gated off

---

## 5. The attribution model (read it in one table)

| Run scenario                                                         | Counts toward Organization total? | Who owns the Owner dimension | Who owns the Actor dimension                                                                  | Label           |
| -------------------------------------------------------------------- | --------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------- | --------------- |
| Published Agent used normally by a member                            | Yes                               | Agent owner                  | The triggering member                                                                         | production      |
| Unpublished Agent debugged by a builder                              | Yes                               | Agent owner                  | The debugger                                                                                  | debug           |
| Draft revision of a published Agent in preview / debug               | Yes                               | Agent owner                  | The debugger                                                                                  | preview / debug |
| Scheduled Agent running automatically                                | Yes                               | Agent owner                  | Schedule owner (falls into the system bucket when there is no explicit person)                | scheduled       |
| Channel-triggered (external users from Slack / Discord / Lark, etc.) | Yes                               | Agent owner                  | **NULL** (external users are not Mosoo members; they go into the separate By User footer row) | channel         |

**Two invariants**:

1. An Agent's publish status, owner transfers, and revision archiving **must never rewrite the interpretation of historical cost**. Sarah is the owner today, so the old records stay under Sarah; hand off to Tom tomorrow, and only new records go to Tom.
2. **Used by** and **Owned by** are different attributions of the same set of usage events, and there is **no double-counting**. Switching attribution mode in the By User tab ≠ switching to a different ledger.

---

## 6. How cost is calculated (plain version)

The USD you see on the dashboard is determined by four kinds of tokens:

```
total_cost
  = billable_input_cost       ← the part actually charged at the base input price (cache_read deducted first)
  + output_cost
  + cache_read_cost           ← input that hit the cache, charged at a separate, cheaper rate
  + cache_creation_cost       ← input written into the cache for the first time
```

In plain words: "**only input that did not hit the cache is charged at the base input price**." This matters a lot — many teams' cost dashboards charge cache_read tokens again at the base input price, and it's common for the bill to be inflated by 30–50%. Mosoo's cost formula locks onto the cache-adjusted version.

The bottom of every tab spells out the complete formula — so anyone looking over your shoulder at the dashboard can trust the numbers.

### What about models with unknown pricing

The dashboard **never drops** usage for an unknown model. It labels that usage separately as "unpriced usage" and gives the admin an action to backfill the pricing. The frontend only displays results; it **does not re-interpret the price table** — when a price is wrong, the admin fixes it in exactly one place.

---

## 7. User journey maps

### A · Admin's end-of-month audit

| Stage               | What the admin is doing                                                          | What they see                                                               | Mood      |
| ------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------- |
| 1 Trigger           | At month's end, wants to see how much was spent                                  | Clicks `Cost` in the sidebar                                                | Neutral   |
| 2 Overview          | On the Overview tab, looks at the 4 KPIs + 30-day bar chart                      | "$4.82K · -12.3% vs. prior 30 days" — answers the main question at a glance | Reassured |
| 3 Drill in          | Clicks the Top Agents ranking → jumps to the By Agent tab                        | Sees the customer-support agent at 28%                                      | Alert     |
| 4 Locate the person | Switches to the By Agent tab, sorts by vs. Prev to find the spiking row          | Sarah's research-bot is +180% week over week                                | Zeroed in |
| 5 Close the loop    | Exports CSV to attach to the monthly report; @-mentions Sarah about research-bot | Has the raw data to show                                                    | Efficient |

### B · Agent owner explains a cache-hit anomaly

1. The owner notices the customer-support agent's cost doubled this week
2. Opens the Agent detail page → Cost tab
3. Sees Cache Hit drop from 78% to 12%
4. Infers: someone must have changed the system prompt and fragmented the prompt prefix
5. Opens the Manifest history — discovers Tom changed the second paragraph of the system prompt yesterday
6. Rolls back / talks to Tom, and cache hit recovers the next day

### C · Personal expense report

1. At month's end, an individual wants to know "how much did I use"
2. Opens `Settings → Usage`
3. In the **Used by me** section, sees "$42.18 this month"
4. The "Recent sessions" list shows the most recent 7 sessions + cache tokens
5. Takes a screenshot / exports CSV for the expense report

### D · External channel cost attribution

1. The admin looks at the By User tab and finds that summing across users only reaches $4.1K, but the Org Total is $4.83K
2. No panic — a fixed row at the bottom of the table reads `External (channel-triggered): $730 · 15.1% of Org Total`
3. This portion was triggered by external users via Slack `@bot` / Lark DM, etc., with no Mosoo member attribution
4. The admin knows where the difference comes from, and the books reconcile
