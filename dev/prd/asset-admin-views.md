# Asset Admin Views — for humans

> This is the product-story version written for non-engineer readers. The full engineering contract lives in the shipped PRD.

---

## In one sentence

Every asset page (Agent / Space / Skill / MCP / Environment) shares a single unified **Scope filter**—`Mine` / `Shared with me` / `All organization`—so that Owners and Admins can deliberately switch into an "organization view" instead of having the assets that an Admin can see-through flood their everyday list.

> This PRD is not about building a single unified Asset Ledger page. The Ledger is reserved as a future enterprise direction; this round only aligns the scope mental model within each individual asset page.

---

## User problem

Owners and Admins have see-through visibility into every asset in the organization, but when they open `/agent`, `/space`, `/integrations`, or Environment, **the first thing they want to see is still their own everyday working list**.

Two ways this goes wrong:

- **Mixing the private assets that an Admin can see directly into the default list** → this breaks the `Mine / Shared with me` mental model; it feels like a pile of other people's private assets has been force-shared onto you.
- **Building a single unified Asset Ledger entry point** → too heavy for this round; it only makes sense when it can answer cross-asset inventory / access graph / blast radius questions.

The compromise: **each asset page keeps its everyday list, plus a uniform Scope filter on top**, so that Owners and Admins can deliberately switch to `All organization` when they need to.

---

## Goals

- All asset pages use the same scope mental model: `Mine` / `Shared with me` / `All organization`.
- `All organization` is **visible only to Owners and Admins**, and is **not the default view**.
- Assets that an Admin can see-through **do not enter** `Shared with me`—see-through access is not sharing.
- Each asset page keeps only the filters it genuinely needs, rather than baking governance assumptions into a complex taxonomy.
- Management actions still happen back in the original asset detail / Settings; we do not build a cross-asset disposition center.

---

## Scope filter overview

| Option             | Who can see it     | Meaning                                                       | Can it be the default          |
| ------------------ | ------------------ | ------------------------------------------------------------- | ------------------------------ |
| `Mine`             | Everyone           | Assets I own, created, or am primarily responsible for        | ✅ Yes                         |
| `Shared with me`   | Everyone           | Assets I gained through collaborator / ACL / org-wide sharing | ✅ Yes                         |
| `All organization` | Owner / Admin only | All assets of the same type within the organization           | ❌ Must be selected explicitly |

---

## Product rules (5 mental-model locks)

1. **`All organization` is never the default.** Members cannot see this option; Owners and Admins also land on the everyday view by default. Refreshing or re-entering does not "remember" the organization view.
2. **`Shared with me` only represents a sharing relationship.** Only collaborator grants, ACL matches, and org-wide sharing belong here; assets an Admin can see thanks to see-through permissions do not count.
3. **Filters have two layers.** The first layer is the unified `Scope`; the second layer is each asset's own small set of essential filters—Agent cares about status / creator, Space cares about owner, Skill cares about owner / source kind, MCP cares about configuration status, Environment cares about owner.
4. **Management actions go back to the original asset page.** This PRD does not build a unified disposition center. The list is only responsible for "you can find it and get to it"; changing ACL / Delete / Edit all jump back to the original asset detail or Settings, where they remain bound by RBAC and the creator-status policy.
5. **Sensitive dependencies show signals only, never leak secrets.** Credential / Vault Item / Personal MCP may surface a masked label, status, holder, and used-by count, but the full token / API key is never displayed.

---

## Asset page overview

| Asset page  | Essential filters (besides Scope) | Management entry points                                             |
| ----------- | --------------------------------- | ------------------------------------------------------------------- |
| Agent       | Status / Creator                  | Open agent detail, Edit manifest, Publish settings                  |
| Space       | Owner                             | Open Space, Settings sheet, Delete Space (locked by creator-status) |
| Skill       | Owner / Source kind               | Open Skill detail, Share settings                                   |
| MCP Server  | Configuration status              | Open MCP detail, Configuration settings                             |
| Environment | Owner                             | Open Environment detail, Environment settings                       |

---

> Full engineering contract (including scope / out-of-scope / edge cases / decision boundaries): see the shipped Asset Admin Views PRD.
