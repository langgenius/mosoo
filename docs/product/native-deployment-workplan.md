# Native Deployment Workplan — Implementation Handoff

> **Status**: Handoff for implementation session · **Last updated**: 2026-07-06 · **Owner**: Evan (product)
>
> The demo contract this plan serves is [Native Deployment Happy Path](./native-deployment-happy-path.md) — read it first; this document adds the implementation-facing inventories: what is locked, what is agent-first legacy to rethink, what changes where, in which order. Code facts are grounded in `main` @ `1c590f3` and `langgenius/mosoo-connector` @ `9bc9644`.
>
> Companion drafts still local-only (not in-repo): `docs/prd/mosoo-native-deployment-protocol.md`, ADR 0001–0003, `docs/product/mosoo-native-deployment-protocol.md`, `agent-app-market-decision-map.md`, `CONTEXT.md`. Their delta checklist is §7.

## 1. Locked decisions

Decisions from the design sessions that shape code. Items 1–4 are locked; item 5 has a recommended default and must be confirmed at Phase 0 entry.

1. **The mechanism being fixed.** A repo can *reference* agents but cannot *define* them — `[[agents]]` resolves by name against pre-existing published agents on the target instance (`app-agent-binding-resolution.ts:41`), so agent identity is instance state and the artifact is not self-sufficient. The fix is **in-repo agent definition + deploy-time upsert**, not UUID-stripping. (An agent UUID in the repo was the working theory; code disproved it.)
2. **API shape.** App is a namespace, not an endpoint: `…/api/v1/apps/{app-slug}/agents/{name}/threads`; the API surface is exactly the per-agent `expose` subset; no ULID on any consumer surface. **Auth rides account PATs in v1** — App-scoped keys deferred (non-goal). No default-agent shorthand route.
3. **Version semantics.** Commit versions the artifact as a whole; one deploy upserts all agents (new / updated / unchanged); per-agent DeploymentVersions are snapshots derived from the commit. Console-authored apps keep publish-minted versions — the Overview source module is polymorphic over this.
4. **Instance-state boundary.** The only state a target instance must pre-hold: provider credentials (+ the org/app shell). Everything else travels in the artifact; secrets never travel (same red line as the `.agent` package contract). This boundary is what makes the second-instance demo beat an architectural consequence rather than a feature.
5. **Protocol vs generic detection** *(confirm at Phase 0 entry; recommended default)*: manifest present → protocol path; plain static/worker repo without agents → existing generic detector (`app-deployment-detector.ts`). One boundary sentence in the protocol PRD keeps the two pipelines from drifting into each other.

Also locked via the happy path contract's negative-space list: no app-type picker, no import wizard on the main path, no "detecting target" null label, validation errors in repo terms.

## 2. Agent-first legacy inventory (the rethink list)

Dividing principle: **runtime, sessions, and delivery stay agent-level; deliverable, version truth, API namespace, and console hero move to App/artifact level.**

| # | Agent-first artifact | Evidence | Verdict under App-first |
| --- | --- | --- | --- |
| 1 | `publishAgent` verb + status machine (draft/published, `liveDeploymentVersionId`) | `agent-lifecycle-command.service.ts:40` | **Split the verb** (see §2.1) |
| 2 | `agentId` *is* the endpoint id — `/api/v1/agents/{ULID}/threads` | `public-api-route.ts:111`, agent-endpoint-mvp | Re-home under the app namespace, name-addressed; ULID becomes internal |
| 3 | Distribution quartet hangs per-agent (skill.md / API Access / Thread / Channel) | `publish-menu.tsx:65` | Disperse: skill.md → App-level export (SPEC already says so); API Access → Overview Connect; per-agent Thread shell stays but is linked from Connect; Channel stays agent-level (correct) |
| 4 | `.agent` package = per-agent deliverable (export/import/fork) | `agent-package-export.service.ts:26` | Deliverable role superseded by the protocol repo; its name-resolution core becomes the upsert engine; Fork stays; import wizard demoted to compatibility entrance (never on the main path) |
| 5 | `AgentDeploymentVersion` as version truth | versions sheet | Demoted to derived snapshot; commit is artifact truth for repo-backed apps; console path still mints via publish |
| 6 | Agent ULID as user-facing identity (`/agent/:agentId`, `agent-id-badge`, API Access panel) | `route-registry.tsx:107`, `api-access-panel.tsx:91` | ULID exits all consumer surfaces; stays on management surfaces; console URL untouched (low priority) |
| 7 | "New agent" as Overview header primary CTA | `app-overview.route.tsx:48` | Demote to Agents page; the artifact-first primary verb is deploy/install (empty state already correct) |
| 8 | Per-agent Logs/Cost tabs | agent-detail tabs | Keep as drilldown; App-level rollup is the first screen (SPEC-aligned, no new work) |
| 9 | Thread/Session owned by Agent | SPEC lock | **Correct agent-first — do not touch** |
| 10 | Channel binding owned by Agent | SPEC lock | Correct — do not touch (P1 deferred anyway) |
| 11 | Capability URL minted per (App, Agent), requires published agent | `app-agent-capability.ts:27` | Mechanism stays; resolution target becomes repo-upserted agents; the cross-instance failure class disappears |
| 12 | Generated CLI command surface is agent-first (`create-agent`, `run --input-agent-id`, `agents publish`) | mosoo-connector README | **Self-heals with the contract** — the CLI is generated; fix the API and it follows |

Also legacy at the docs layer: the "Agents & packaging" PRD cluster (agent-manifest, agent-versions, agent-service-identity, agent-endpoint-mvp, agent-package-import-export-fork) needs drift notes in `docs/prd/README.md` once the protocol PRD lands (§7).

### 2.1 The Publish verb split (why "Publish 交付" felt tricky)

Agent-first welded two meanings into one button: *make this agent callable* (runtime state flip) and *produce the distributable deliverable* (skill.md, API access hung off the publish menu). The split:

- **Publish** (agent-level, kept): state flip only — draft → callable, mints a DeploymentVersion. Becomes an internal/secondary verb.
- **Deliver** (artifact-level, the new primary): the deliverable is the protocol repo; deploy consumes it. On the protocol path, **deploy subsumes publish** (upsert → publish each agent) and the user never touches a publish button. On the console path (Path B), the Publish button remains but its success surface points at the App-level deliverable (export / conformance), not a per-agent distribution quartet.

## 3. Frontend change inventory

Zero-change zones first: `navigation.tsx` sidebar, Threads pages, agent editor core (`form-sections`, `preview-mode` internals), channels family, onboarding.

**Zone 1 · Overview slot polymorphism** (`apps/web/src/routes/app-overview/deploy/`)

| # | Change | Files |
| --- | --- | --- |
| 1 | S1 hero variants: keep web PreviewFrame; add **Connect card** (endpoint, PAT pointer, curl tabs, playground link, 24h mini-stats); add **multi-agent surface table**; add both-mode strip | `deploy-overview.tsx` + 2 new components |
| 2 | S2 address species: API mode shows playground row + namespace base | `deploy-url-card.tsx` |
| 3 | Detection result card (protocol version / target / agent count); kill the `targetKind === null → "detecting target"` fallback | `deployments-history.tsx:129`, `deploy-console-data.ts` |
| 4 | S4 phase rows data-driven ("provision 3 agents …"); failure rows expand to repo-term error + fix hint | `deployments-history.tsx` |
| 5 | Data seam: `appOverview` gains exposure/agents/endpoint fields (GraphQL codegen ripple) | `deploy-console-data.ts`, `use-deploy-console.ts` |
| 6 | Empty-state copy: "static, worker **or agent-only**" | `deploy-repo-card.tsx` |
| 7 | Acceptance fixtures for all four exposure states | `v0-deploy-preview.route.tsx` |

**Zone 2 · Connect & consumption** (`apps/web/src/routes/agent/`)

| # | Change | Files |
| --- | --- | --- |
| 8 | URL shapes go name-addressed (`apps/{slug}/agents/{name}`); ULID exits consumer surfaces | `lifecycle/distribution-info.ts`, `api-access-panel.tsx` |
| 9 | Playground promoted: reachable from Overview Connect, multi-agent picker | `consume-mode.tsx` reuse |

**Zone 3 · Publish convergence (Path B, can trail)**

| # | Change | Files |
| --- | --- | --- |
| 10 | Publish success surface presents the App-level deliverable (export repo CTA; conformance copy until backend export exists) | `publish-menu.tsx`, publish-success-modal |
| 11 | Version rows carry commit SHA when repo-backed | `versions-tab.tsx` |

*(Removed from scope: App-scoped key management panel — PAT interim decision.)*

## 4. Workload distribution

| Layer | Share | Content | Risk |
| --- | --- | --- | --- |
| Protocol contract | ~15% | manifest schema, validate rules, error codes (`pkgs/contracts`) | Low, but upstream of everything — do first |
| **Backend pipeline** | **~40%** | detection branch, **agent upsert** (reuse `agent-package-import` resolve services), executor phases, namespace routes, OpenAPI per app, slug minting | **Highest**: upsert semantics (rename/delete/downgrade) is the hard core |
| Frontend console | ~25% | §3 inventory | Low — thin display layer, many small pieces |
| CLI (via connector) | ~5% | response-shape fields + overlay yaml (`deploy` shortcut, `validate` command) + lathe-include prose; no hand-written Go | Low; adds cross-repo build coordination |
| e2e + docs | ~15% | storyboard-as-e2e (extend `v0-deploy-preview` fixture pattern), doc backfills | Low |

## 5. Phases (exit criterion = a recordable demo beat)

- **Phase 0 · Contract.** Manifest schema + server-side validate + error codes. Zero frontend. **Exit: fixture repos get red/green validate output entirely in repo terms.** Confirm locked-decision #5 at entry. Frontend fixtures (#7) can start in parallel.
- **Phase 1 · Paste-to-live.** Detection branch + agent upsert + auto-publish + endpoint activation; frontend detection card + S4 phases + failure expansion. **Exit: on one instance, repo → deploy green → agent answers (existing PAT fine) — storyboard beat 2 recordable.**
- **Phase 2 · Connect.** Namespace routes + Connect card + multi-agent surface + playground promotion; connector overlay for `deploy` shortcut + `validate` command (doctor-style JSON). **Exit: a stranger reaches a 200 with curl in under ten minutes (TT-200) — beat 4 recordable.**
- **Phase 3 · Portability + parity.** Second-instance SLO harness + response-shape noun parity verified through the generated CLI + storyboard e2e. **Exit: the 3-minute master demo records end to end.** Smallest phase by code — if the instance-state boundary held in Phase 1, this is verification, not construction.
- **Phase 4 · Path B.** Publish → artifact export + Overview source module console-state. **Exit: the 60-second companion recording.** Independent; can trail.

Dependencies: 0 → 1 → 2 serial; 3 verifies; 4 detachable. The thinnest first slice across 0/1: **manifest parse + validate + upsert + name-addressed endpoint** — when that lands, the protocol is proven.

## 6. Cross-repo coordination (mosoo-connector / Lathe)

The CLI is generated Go via Lathe from Mosoo's exported OpenAPI/GraphQL specs; overlays supply shortcuts, examples, `output_hints` (JSON paths), `follow_up_commands`, and known errors; the publishable Mosoo Skill regenerates on every `make build`. Consequences:

- **Noun parity is a response-shape property.** `deployApp` / run-status responses must carry endpoints, run number, commit, phases, next step; the `deploy` overlay shortcut points `output_hints` at them. The pretty terminal block in the happy path doc is an information contract, not a rendering promise.
- **`validate` = one server-side operation, two entrances** (generated CLI command + pre-deploy hook), reporting doctor-style versioned JSON (`schemaVersion`, stable `failures[].code`/`action`). Offline local validation is a non-goal.
- **The Skill is where P0's journey is taught** (`publish/skills/mosoo/references/cli.md`, edited via `lathe-include/`) — "terminal teaches, console mirrors" lands in skill prose, not stdout formatting.
- **Coordination step per phase** (1 and 2): mosoo spec export changes → connector `make build` → skill republish. Today's shortcuts are `ls` / `run` / `add-key` / `create-agent`; `deploy` and `validate` are the additions. The existing generated command `mosoo console apps deploy-app` already maps to the mutation.

## 7. Local companion-doc delta checklist

These drafts live only on the author's machine; verify each against the locked decisions when landing them:

| Document | Action |
| --- | --- |
| `prd/mosoo-native-deployment-protocol.md` | Fold in §1 items 1–5; validate dual-entrance + repo-term errors; response-shape spec for deploy nouns (not CLI behavior); non-goals: default shorthand, App keys, per-agent key limits, offline validate, auto-redeploy; open decision: slug minting/rename policy (slug stability = API compatibility promise) |
| `product/mosoo-native-deployment-protocol.md` | **Fix the motivating story if it says "UUID travels in the repo"** — the mechanism is "repo references but cannot define; agent identity is instance state." Reference the happy path doc for personas/aha instead of restating |
| `adr/0001` | Consequences: two ship verbs converge on one artifact; measurable consequence = portability SLO; verify drivers cite the corrected mechanism |
| `adr/0002` | Precision from multi-agent: definition = all agents in repo; exposure = per-agent `expose` → API subset + web env bindings; consequence: `deployment_agent_not_found` stops being a cross-instance failure class |
| `adr/0003` | Add code evidence anchors (whitelist detection, null label); add the boundary sentence from §1.5 |
| `prd/README.md` | Index protocol PRD + happy path + this workplan; drift notes on `app-deployment.md` (detection + `[[agents]]` superseded) and the Agents & packaging cluster |
| `product/agent-app-market-decision-map.md` | One dependency line: market's technical precondition = portability SLO; Fork-someone's-app deferred to market phase |
| `CONTEXT.md` | Pointers: happy path = demo/acceptance contract; this workplan = implementation map; the corrected-mechanism one-liner |

## 8. New-session bootstrap

1. Read [the happy path contract](./native-deployment-happy-path.md), then this workplan.
2. Confirm §1.5 (detection boundary) and the happy path doc's open questions 1–5 with the PM if unanswered.
3. Start Phase 0: manifest contract in `pkgs/contracts`, validate service, error codes — with the §5 thin slice as the target.
4. Reuse before building: `agent-package-import.service.ts` name-resolution for upsert; public-thread API for endpoints; `v0-deploy-preview` fixture pattern for acceptance.
