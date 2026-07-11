# Environment - for humans

Status: partial. App ownership, revisions, defaults, selection, package
installation, setup script, and environment-variable injection are shipped.
Network/MCP/package-manager policy enforcement is stored intent only and is
explicitly labeled as not enforced in the editor.

> This is the product-story version for non-engineer readers. Exact revision,
> lifecycle, and execution-snapshot behavior lives in Environment contracts and
> the current API implementation.
>
> **Current App boundary note**: Environment is an App-local runtime template. It belongs to one App, Agents in that App can select it, and Session start freezes the selected revision into the execution snapshot. Tenant-wide defaults, tenant policy controls, and cross-App copies are future governance or migration concerns. Preserve EnvironmentRevision freeze semantics. See [App Boundary](./app-boundary.md).

---

## One-line positioning

**An Environment is the saved runtime template for an Agent**. Today Runtime
installs its declared packages, runs its setup script, and injects environment
variables. Network-policy fields are versioned intent, not enforced behavior.

An Environment is not an access model. It is an App-owned runtime template that one or more Agents in the same App can select by reference.

Analogy:

> Think of App-owned package, runtime-variable, and setup automation. The stored
> network section is future enforcement input, not current isolation.

It sits alongside the other App-owned resources:

| Asset           | In one line                                                 |
| --------------- | ----------------------------------------------------------- |
| **Agent**       | App-local execution and delivery unit                       |
| **Files**       | Uploaded files an Agent can read, scoped per upload/session |
| **Skill**       | App-local capability package                                |
| **MCP Server**  | App-local tool connector definition                         |
| **Environment** | App-local runtime template an Agent executes inside         |

---

## 1. Problem

Alex is an App owner building a data-analysis Agent that needs `pandas`, `numpy`,
and a repeatable setup script.

Without Environment, he has only bad choices:

- Ask the Agent to install packages during each Session
- Spend extra cold-start time in every run
- Lose package/version clarity when a downstream run breaks
- Hide runtime dependencies in prompt text instead of App configuration

With Environment, Alex creates one App-local runtime template, declares its
packages and setup script, selects it on the Agent, and lets every new Session
freeze the selected Environment revision at start.

Riley is configuring a second Agent in the same App. The Agent form should
resolve the App default Environment while still letting her pick another
Environment from the same App. She must not assume the stored network policy is
enforced.

---

## 2. Goals

When this is done, an App owner should be able to:

- Create a named Environment inside the active App with packages, setup script,
  and env vars
- See stored network intent labeled as saved-only/not enforced rather than an
  active runtime or security promise
- Mark one Environment as the App default so new Agents in that App preselect it
- Pick an Environment from the Agent config page
- Create a new Environment from the Agent form without leaving the configuration flow
- Copy an App-local Environment through the GraphQL API when they need an independent runtime template; the current Web UI does not expose this action
- See that each Session freezes the selected Environment revision at Session start
- Delete an Environment only when it is neither the App default nor referenced by an Agent; the API rejects those cases and the Web shows the returned error

---

## 3. Concept definitions

| Term                           | Plain-language definition                                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Environment**                | App-owned runtime template. Packages, setup script, and env vars are applied; network fields are versioned intent only. It does not contain Files, Skills, or MCP servers. |
| **App default Environment**    | The Environment preselected for new Agents in one App. It is scoped to that App and does not apply tenant-wide.                                                            |
| **Network - Full**             | Persisted policy label only. Runtime does not currently enforce this field.                                                                                                |
| **Network - Limited**          | Persisted policy intent only. It does not currently restrict Sandbox egress.                                                                                               |
| **Allowed Hosts**              | Stored allowlist intent under Limited; not consumed by Runtime today.                                                                                                      |
| **Packages**                   | Dependencies installed before Agent execution through the generated setup script, such as pip / npm / apt packages. Versions can be pinned.                                |
| **Setup Script**               | Shell snippet that runs before the Agent process starts. If it fails, the Session fails to start.                                                                          |
| **Env Vars**                   | Plain key/value inputs submitted through masked UI and encrypted at rest by the backend. Reusing a token across resources requires entering it separately in each place.   |
| **Environment Revision**       | Immutable saved version of an Environment configuration.                                                                                                                   |
| **Session execution snapshot** | Runtime copy of the selected Environment revision. Editing the Environment later does not affect an already-started Session.                                               |
| **Copy**                       | API-only independent duplicate inside the same App. The copy does not sync with the source; the current Web has no Copy control.                                           |

---

## 4. Relationship rule: Environment does not nest other assets

Environment is orthogonal to the other App-owned resources. An Agent references Environment, Skill, and MCP bindings separately, and reads Files. The Environment itself does not contain those resources.

```mermaid
flowchart LR
  App[App] --> DefaultEnvironment[App default Environment]
  App --> Environment
  App --> Agent
  Agent --> Environment
  Agent --> Files[Files]
  Agent --> Skill
  Agent --> MCP[MCP Server]
  Environment --> Network[Network intent<br/>not enforced]
  Environment --> Packages[Installed packages]
  Environment --> SetupScript[Setup script]
  Environment --> EnvVars[Env vars]
  Session[Session start] --> Snapshot[Freeze selected Environment revision]
```

Why no nesting: Files are uploaded data inputs, MCP and Skill are Agent capability inputs, and Environment is runtime shape. Keeping those concepts separate prevents a runtime template from becoming a "manages everything" container.

---

## 5. V1 ownership and revision semantics

Environment has one current ownership model:

| Capability                             | V1 behavior                                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Create Environment                     | App owner only, inside the active App                                                                |
| Read / edit / delete Environment       | App owner only                                                                                       |
| Select Environment on an Agent         | App owner only, and only for Agents in the same App                                                  |
| Set App default Environment            | App owner only, scoped to one App                                                                    |
| Copy Environment                       | App owner only through the GraphQL API, producing a new independent Environment in the same App      |
| Start Session                          | Runtime freezes the selected Environment revision into the Session execution snapshot                |
| Cross-App or legacy Environment id use | Fail closed; do not infer access from tenant state, package metadata, snapshots, or a tenant default |

Hard rules:

- Environment belongs to one App.
- Agent configuration is the only V1 consumption path for Environment.
- App default Environment is scoped to one App.
- Environment edits affect only future Sessions.
- Missing or mismatched App proof must become an explicit UI/runtime error, not a compatibility path.

---

## 6. Journeys

### App owner creates a runtime template and sets it as App default

| Stage          | Experience                                                                                 | Result                                                                          |
| -------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Discover       | Alex opens the active App's Environments surface                                           | The list shows App-local runtime templates only                                 |
| Create         | He creates `data-analysis`, pins packages, writes the setup script and env vars, and saves | A new Environment revision is available in the same App                         |
| Set as default | He marks `data-analysis` as the App default                                                | New Agents in this App preselect it; existing Agents keep their current setting |
| Run            | A Session starts from an Agent that selected `data-analysis`                               | Runtime freezes the selected revision into that Session's execution snapshot    |

### App owner configures a second Agent

| Stage            | Experience                                           | Result                                                     |
| ---------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| Open Agent form  | Riley opens an Agent in the same App                 | The picker resolves the App default Environment            |
| Needs variation  | She needs one extra package                          | She creates or copies an Environment inside the same App   |
| Continue editing | She selects the copied Environment in the Agent form | The Agent now has an explicit App-local runtime dependency |

### Runtime rejects stale or cross-App references

| Stage       | Experience                                                                | Result                                                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import      | A package carries Environment intent or a foreign Environment id          | Current import leaves `environmentId` null, does not name-match/recreate, and does not add a selection issue; only secret names create repair issues. Session startup may therefore use the target App default Environment. |
| Run         | A Session starts with an Agent / Environment App mismatch                 | Runtime fails closed with an explicit Environment resolution error                                                                                                                                                          |
| Maintenance | An Environment is deleted while it is the App default or still referenced | The delete is rejected and the Web displays the API error                                                                                                                                                                   |

---

## Future governance, not V1

The following topics can be revisited only after the V1 App boundary is stable:

- Tenant-wide Environment defaults
- Tenant policy controls for runtime network settings
- Multi-account access to an Environment
- Human role matrices for Environments
- Cross-App copy and transfer flows
- Audit and review surfaces

Do not keep dormant routes, schema fields, or tests for these topics in the current V1 surface.

---

> Ownership, revision lifecycle, package installation, setup script, env-var,
> and execution-snapshot behavior are enforced by current contracts and tests.
> Stored network intent is not Runtime enforcement.
