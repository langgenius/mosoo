# Project Usage

What the Project Usage view and an Agent's **Cost** tab show, and how far their numbers can be trusted.

## Promises

- Usage is built from the model calls mosoo records. Dollar amounts are estimates from observed tokens and mosoo's reference prices, or the USD amount a runtime reported.
- **Overview**, **By Agent** and **By Model** break usage down by run type and time range, and each tab exports to CSV. Usage without an Agent appears as **Direct sessions**.
- A later, more complete report for the same model call replaces that call's estimate. A price change does not recompute history.

## Limits

- It is not an invoice or a mosoo charge: no taxes, credits, discounts, subscriptions or infrastructure costs, and no budgets, alerts or payments.
- A model without a reference price stays visible and is flagged for pricing, but adds $0 unless the runtime reported a USD amount, so totals can be understated. **Set pricing** opens Providers; there is no price editor.
- An Agent's **Cost** tab shows its latest seven usage events, whatever time range is selected.
