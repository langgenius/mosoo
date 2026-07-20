# App Usage

Status: active usage view; not a bill.

## Problem and value

Builders need to understand where an App's model usage is growing before it becomes an expensive surprise. App Usage turns recorded model calls into trends that help an App owner identify costly Agents, models, and run types. It is decision support, not a source of financial truth.

## Users

The current user is the single owner of the selected App. App Users cannot see this view, and there are no team roles, shared budgets, or per-person controls.

## User flow

1. Open **App Settings -> App usage**.
2. Choose **All**, **Production**, or **Debug**, then select 7 days, 30 days, month to date, or 90 days.
3. Use **Overview** to review estimated spend, model calls, tokens, active actors, daily spend, top Agents, and model mix.
4. Use **By Agent** to compare usage and spend, then open an Agent's **Cost** tab for its model mix and latest usage events.
5. Use **By Model** to inspect price coverage and find models that need attention. The current **Set pricing** action opens Provider settings; it does not offer a custom price editor.
6. Export the current tab as CSV for offline review.

## Current availability and visible boundaries

The shipped view uses model-call usage recorded by mosoo. For recognized models, dollar amounts are estimates calculated from observed tokens and mosoo's reference prices. For an unknown model, mosoo may retain a reported USD amount; without one, usage remains visible and the model is marked for pricing attention, but the event contributes $0, so totals can be understated.

This view is not a Provider invoice or a mosoo charge. It does not reconcile taxes, credits, discounts, subscriptions, or infrastructure costs. **All** can include usage types that have no separate filter. On an Agent's Cost tab, the latest seven usage events are shown and currently are not limited by the selected time range. Budgets, alerts, invoices, and payment controls are not available here.

## Historical ledger reconciliation

The API can audit model calls created before atomic model-call and usage-ledger persistence was introduced. The workflow is disabled unless `MOSOO_COST_LEDGER_RECONCILIATION_MODE` is set to `audit` or `repair`:

- `audit` is read-only and reports bounded page counts for present, repairable, skipped, and indeterminate records.
- `repair` inserts only recent records whose source identity and immutable published-run context can be reconstructed. The existing `(source, source_event_id)` uniqueness boundary makes retries idempotent and prevents reconciliation from replacing a concurrent runtime write.
- Both modes use durable API commands with cursors. A new run starts at 01:00 UTC, and every page re-evaluates the current retention cutoff so a delayed retry cannot recreate detail that a later daily rollup has already consumed.
- Only the seven-day raw-detail window is eligible for repair. Older model-call history may already be represented by a daily rollup, so it is reported as indeterminate and is never inserted or used to rewrite an aggregate.
- Missing driver identity, usage metadata, published revision, or run context is reported as indeterminate instead of being inferred from mutable current state.
- Calls created before the current raw-detail window, invalid stored usage values, and events that may already exist under a historical driver identity are also indeterminate; repair never normalizes or guesses through these states.

Operators should begin with `audit`, inspect the structured `cost.ledger_reconciliation.page_completed` logs, enable `repair` only after reviewing those classifications, and unset the variable after the intended reconciliation run. This workflow repairs locally provable ledger gaps; it does not compare mosoo estimates with a Provider invoice.
