# Agent Import, Export, and Fork — current product contract

Status: partially shipped. Fork and `.agent` transport exist; embedded Skill
restoration works, while MCP/Environment restoration and some assets remain
intent-only or incomplete as documented below.

Field-level authority lives in `pkgs/agent-package/src/`,
`pkgs/contracts/src/agent/agent-manifest-serializer.contract.ts`, and the Agent
package services under `apps/api/src/modules/agents/application/`.

## Product boundary

A `.agent` file is the portable Agent definition. It is not a whole App export
and does not contain source App identity, Vibe App state, credentials,
Sessions, logs, cost, or Sandbox/runtime state.

The package's legacy `app` object contains only Agent display metadata (name,
description, and an avatar asset key). It does not describe the owning Mosoo App.
The current exporter writes `avatarAssetKey: null` and emits no avatar or brand
asset.

## Shipped actions

### Fork Agent

Fork creates an editable draft in the same App.

- It copies Agent identity/config intent, the selected Environment reference,
  source Skills that remain accessible, and package-owned Skill material.
- It does not copy Sessions, logs, cost, or runtime/Sandbox state.
- MCP bindings become package intents with `serverId: null` and a
  `needs_reconnect` issue; the fork does not silently reuse MCP credentials.
- Runtime/model availability is checked and reported on the new draft.

### Export Agent

Export creates a `.agent` ZIP containing the portable manifest plus the current
sidecars and embedded Skill files described below. IDs that cannot prove access
in another App are removed: Environment id becomes null, MCP server ids become
null, and Skills use package paths.

### Import Agent

Import is a single operation: parse and validate the archive, create a new Agent
draft, then show a resolution report. It is not an item-by-item repair wizard.
Users repair issues through the ordinary Agent editor and linked configuration
surfaces.

Current automatic resolution is deliberately narrow:

- valid embedded Skills are materialized into the target App/draft;
- runtime/model availability issues are reported;
- every MCP declaration remains an unbound intent and reports
  `needs_reconnect`;
- the Environment sidecar is validated, but import sets `environmentId: null`,
  does not match by name, does not recreate an Environment, and currently does
  not add a selection repair issue. Only declared Environment secret names add
  repair issues; Session startup may therefore use the target App default.

## Archive layout

```text
my-agent.agent
├── manifest.json
├── environment/
│   └── definition.json
├── .mcp.json                       # only when MCP declarations exist
└── skills/
    └── <skill-name>/
        ├── SKILL.md
        └── ...                     # scripts/references/assets from that Skill
```

### `manifest.json`

The package manifest stores Agent display metadata, provenance, the serialized
Agent Manifest, resource references/intents, package version, and the embedded
asset catalog. `sourceAgentId` is provenance only; import does not use it as
target-App authority.

### `skills/`

Skills are the only resource type whose package files are currently appended as
assets by the exporter and materialized automatically by import. Each Skill root
must contain `SKILL.md`; package admission controls paths and archive limits.

### `.mcp.json`

The MCP sidecar contains declared server name, URL, transport shape, and optional
icon URL. It contains no credentials. Import/fork do not create or bind an App
MCP server from this file; they retain the intent and require reconnect.

### `environment/definition.json`

The current Environment sidecar contains only:

- `expectedName`;
- `secretNames`;
- `setupScript`.

It is not a complete Environment export: it does not carry an Environment id,
secret values, package inventory, or network policy, and import does not rebuild
or bind an Environment from it.

## Content matrix

| Content                          | Export                   | Fork                            | Import behavior                         |
| -------------------------------- | ------------------------ | ------------------------------- | --------------------------------------- |
| Agent name/description           | Yes                      | Yes                             | Creates editable draft metadata         |
| Agent Manifest/runtime intent    | Yes                      | Yes                             | Preserved subject to current validation |
| System prompt/provider options   | Yes                      | Yes                             | Preserved in draft                      |
| Embedded Skill files             | Yes                      | Reuses/copies accessible Skills | Materialized when valid                 |
| MCP declaration                  | Intent only              | Intent only                     | Unbound; reconnect required             |
| Environment                      | Partial sidecar metadata | Same-App reference retained     | Not auto-bound or recreated             |
| Avatar/logo/brand asset          | Not shipped              | Not copied as an asset          | Remains null                            |
| Provider/MCP/Environment secrets | No                       | No                              | Re-enter or reconnect                   |
| Sessions/logs/cost               | No                       | No                              | Not imported                            |
| Sandbox state/login/cache/memory | No                       | No                              | Not imported                            |

## Security invariants

- A package never carries plaintext Provider keys, MCP tokens, Environment
  secret values, webhook secrets, or OAuth tokens.
- Source resource ids do not prove target-App access.
- Archive paths, declared resources, and sizes are validated before import.
- Missing/unavailable runtime, model, Skill, and MCP dependencies remain
  explicit; import does not fall back to another owner, App, credential, or
  same-name Environment. Environment is the known exception: its selection is
  left null without an issue today, so runtime may resolve the target App
  default. That is an implementation gap rather than successful resolution.

## Current UI

- **Export Agent** produces the `.agent` file.
- **Import Agent** accepts the file, creates the draft, and renders issue cards.
  MCP issues can link to a configuration action; other issue cards may be
  explanatory only.
- **Fork Agent** creates the same-App draft and returns its resolution report.

Avatar packaging, automatic MCP recreation, automatic Environment recreation,
and a multi-step repair/confirmation wizard are not shipped.
