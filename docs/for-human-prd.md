---
name: for-human-prd
description: Mirror an existing mosoo PRD into a high-readability for-human companion that preserves user intent while removing implementation detail. Use when a PRD needs a plain-language companion in its issue, or when the user asks for a "for human" / "human-readable" PRD.
---

# For-Human PRD Companion

Turn an already-shaped mosoo PRD into a readable companion for PMs, founders, designers, GTM teammates, and future reviewers.

This does not replace [`good-prd.md`](./good-prd.md). The full PRD remains the implementation contract; the for-human companion is the product story mirror.

## When to use

Use when a full PRD exists, the user asks for a "for human" / "human-readable" version, the PRD has valuable grill / QA / user-input intent mixed with implementation detail, and the companion should live with the PRD in its issue.

Do not use this to create the original PRD. Draft and grill the full PRD first.

## Inputs

Read the source PRD, [`good-prd.md`](./good-prd.md), [`pm-reverse-interview.md`](./pm-reverse-interview.md), and existing files in `docs/prd/` as tone / length anchors.

Preserve original user / QA / grill intent. Do not flatten real user language into generic "users need clarity" prose.

## Output

Post the companion in the source PRD's issue, as a comment or a section of its body. Do not add a file or an index entry under `docs/prd/`, which holds one product note per area.

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
- Detailed edge-case matrices, reasoning review, and decision-boundary checklists.

Ask: "Can a non-engineer make a product decision from this?" If not, it belongs in the full PRD.

## Workflow

1. Extract the human story: positioning, raw user intent, and user-sayable phrases.
2. Translate the contract into what the user can do / see / expect.
3. Build a small glossary: keep product nouns, remove implementation entities.
4. Mirror essential relationships with one simple mermaid only if it clarifies the product.
5. Add a "do not confuse with" table and post the companion in the PRD's issue.

## Quality Gate

Before posting, scan the companion draft for engineering-detail drift:

```bash
rg -n "POST |GET |schema|interface|resolver|DB|database|call stack|deployment topology|endpoint|OpenAPI|curl" {companion-draft}.md
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
- [ ] Source PRD links to companion.
- [ ] Companion links back to full PRD.

## Example Intent To Preserve

For the Public Thread API, keep phrases like:

- "Help me get this Agent to do one thing."
- "The trusted backend supplies an immutable `userId`; the same user can own
  several Threads and continues a specific one by its returned Thread id."
- "A background API call should show up only in the Access Token owner's private Threads."
