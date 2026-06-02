---
name: for-human-prd
description: Mirror an existing Mosoo PRD into a high-readability for-human companion that preserves user intent while removing implementation detail. Use when a PRD needs a plain-language companion under `dev/prd/`, or when the user asks for a "for human" / "human-readable" PRD.
---

# For-Human PRD Companion

Turn an already-shaped Mosoo PRD into a readable companion for PMs, founders, designers, GTM teammates, and future reviewers.

This does not replace [`good-prd.md`](./good-prd.md). The full PRD remains the implementation contract; the for-human companion is the product story mirror.

## When to use

Use when a full PRD exists, the user asks for a "for human" / "human-readable" version, the PRD has valuable grill / QA / user-input intent mixed with implementation detail, and the companion should live in `dev/prd/`.

Do not use this to create the original PRD. Draft and grill the full PRD first.

## Inputs

Read the source PRD, [`good-prd.md`](./good-prd.md), [`pm-reverse-interview.md`](./pm-reverse-interview.md), and existing files in `dev/prd/` as tone / length anchors.

Preserve original user / QA / grill intent. Do not flatten real user language into generic "users need clarity" prose.

## Output

Create `dev/prd/{prd-slug}.md`, then update `dev/prd/README.md` so the index links to the new companion and the PRD list stays current.

## Keep

Keep only what helps a human understand the product:

- One-line positioning, MVP contract, user problem, goals, concepts, core relationships, user journey.
- Product behavior tables, attribution / ownership / access / visibility rules, compatibility implications.
- A short "do not confuse with..." boundary table and link back to the full PRD.

Mermaid is allowed when it explains a product relationship. Prefer one simple flowchart over dense diagrams.

## Cut

Remove or rewrite implementation-spec material:

- Endpoint / route inventories, OpenAPI / curl examples, JSON schema, request / response contracts.
- TypeScript interfaces, DB fields, entity attributes, resolver / service / module breakdown.
- Sequence diagrams, call stacks, deployment topology, infra wiring, file paths, generated-artifact instructions, test commands.
- Detailed edge-case matrices, thinking audit, and decision-boundary checklists.

Ask: "Can a non-engineer make a product decision from this?" If not, it belongs in the full PRD.

## Workflow

1. Extract the human story: positioning, raw user intent, and user-sayable phrases.
2. Translate the contract into what the user can do / see / expect.
3. Build a small glossary: keep product nouns, remove implementation entities.
4. Mirror essential relationships with one simple mermaid only if it clarifies the product.
5. Add a "do not confuse with" table and register the companion in `dev/prd/README.md`.

## Quality Gate

Scan the companion for engineering-detail drift:

```bash
rg -n "POST |GET |schema|interface|resolver|DB|database|call stack|deployment topology|endpoint|OpenAPI|curl" dev/prd/{prd-slug}.md
```

Expected: no hits, except deliberate orientation links.

For docs-only changes, run:

```bash
git diff --check
```

Run broader repo checks only when code, generated files, schemas, or contracts changed.

## Review Checklist

- [ ] Product problem is written in user language.
- [ ] Historical QA / grill / user-input intent is preserved.
- [ ] A non-engineer can explain the feature after one read.
- [ ] Full PRD remains the only source for implementation details.
- [ ] No endpoint list, schema, interface, DB field, deployment, or call-stack detail leaks in.
- [ ] README links source PRD to companion.
- [ ] Companion links back to full PRD.

## Example Intent To Preserve

For Public Task API, keep phrases like:

- "Help me get this Agent to do one thing."
- "Linear ENG-123 should map to a specific Task in Mosoo."
- "A background task a service token created on its own shouldn't randomly show up in someone's private Threads."
