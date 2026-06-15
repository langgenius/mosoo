# MCP (Connector) - for humans

> This is the product-story version for non-engineering readers. For the complete protocol and security details, use the shipped MCP engineering PRD and the implementation contracts.
>
> Adjacent PRDs: [`credentials`](./credentials.md), [`agent-manifest`](./agent-manifest.md), [`skill-interaction`](./skill-interaction.md), [`app-boundary`](./app-boundary.md).
>
> Current boundary note: V1 MCP is App-owned. App is the implementation namespace; App is the product boundary. MCP servers and secrets live inside one App, and Agents in that App bind them as runtime capabilities. Credentials never travel with exported or forked Agent packages.

---

## One-Line Positioning

> Connect one App to remote tools, then let Agents inside that App use those tools without moving secrets across boundaries.

MCP (Model Context Protocol) is how a Mosoo App gives its Agents access to external tools such as Linear, GitHub, Notion, an internal HTTPS endpoint, or another remote tool server. In V1, MCP is not a company catalog or a role workflow. It is a single-owner App resource that can be created, connected, bound to Agents, and resolved safely at runtime.

V1 is scoped to remote HTTPS MCP servers using Streamable HTTP. Local process transport, marketplace discovery, intranet tunnels, human-role workflows, and global connector catalogs are outside the current App product path.

---

## 1. User Problem

The App owner needs a direct way to make an Agent useful:

| Need                                         | Product answer                                                       |
| -------------------------------------------- | -------------------------------------------------------------------- |
| "This Agent needs to call Linear."           | Add a Linear MCP server inside the active App.                       |
| "This Agent needs a credential."             | Connect an App-local Bearer or OAuth credential for that server.     |
| "This Agent should use the tool at runtime." | Bind the App MCP server in Agent Builder.                            |
| "This Agent package is exported or forked."  | Export only the binding intent; require reconnect in the target App. |

The current product path is intentionally narrow: one App owner configures MCP for one App, then runs Agents that belong to that same App.

---

## 2. Three Concepts

MCP is split into three independent concepts. Do not collapse them.

| Concept               | Plain-language definition                                                                   | Boundary                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **MCP Server**        | Name, HTTPS URL, auth type, display metadata, and connection policy. It contains no secret. | Belongs to exactly one App.                                                                 |
| **MCP Credential**    | Vault-backed Bearer or OAuth material for one MCP server. The UI never echoes the secret.   | Belongs to the same App as the server. It can be app-scoped or explicitly agent-scoped. |
| **Agent MCP Binding** | The Agent config edge saying "this Agent may use this App MCP server."                      | Belongs to one Agent in the same App.                                                       |

This split keeps the invariant simple:

```text
App owns MCP server
App owns MCP credential
Agent binds App-owned MCP server
Runtime resolves credential only inside that same App
```

Deleting or exporting an Agent does not move the MCP credential. Importing a package creates reconnect work in the receiving App instead of reusing a runtime id from the package snapshot.

---

## 3. V1 Credential Model

V1 has two runtime credential shapes:

| Shape                  | Meaning                                                   | Runtime behavior                                                                                  |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **App credential** | Default App credential for one MCP server.                | A `runtime_resolved` Agent binding resolves this credential for the App.                          |
| **Agent credential**   | Explicit credential row for one Agent and one MCP server. | An `agent_bound` binding resolves only when the credential, Agent, server, and App all match. |

Anything else fails closed. A credential from a different App, a different server, a different Agent, or the wrong secret purpose is denied or resolves to no credential.

---

## 4. App MCP Journey

The owner manages MCP from the active App:

```text
App
  MCP
    Add server
      Name
      HTTPS URL
      Auth type
    Connect credential
      Bearer token or OAuth
    Test and save
```

Visible states:

| State                          | What it means                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------- |
| **Not connected**              | The server metadata exists, but runtime cannot resolve a usable credential yet. |
| **Connected**                  | A valid App credential is available for runtime resolution.                     |
| **Credential needs attention** | The credential was revoked, expired without refresh, or failed a secret check.  |
| **Disabled**                   | The server remains in the App but runtime calls should not use it.              |

The App owner can update metadata, reconnect, revoke, disable, enable, or delete the server. Delete removes the server and its credential rows.

---

## 5. Agent Builder Journey

Agent Builder only binds MCP servers already available in the same App:

```text
Agent Builder
  Capabilities
    MCP
      Pick App MCP server
      Choose runtime resolution mode
      Save Agent config
```

Rules:

- The picker only shows MCP servers from the active App.
- The binding stores the server reference and resolution mode, not a raw secret.
- A Session freezes the MCP binding reference as part of its runtime snapshot.
- Runtime resolution checks App ownership, Agent ownership, server ownership, server App, binding App, and credential shape before reading secret material.
- If resolution fails, the Agent call fails with a reconnect or unavailable-capability state instead of falling back to another owner path.

---

## 6. Export, Fork, And Import

MCP package behavior follows the same security rule as Provider credentials and other runtime secrets:

| Operation                           | Current behavior                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| Export Agent package                | Include MCP binding intent and reconnect metadata, not credential material.             |
| Fork inside an App                  | Preserve the binding shape only when it can still resolve inside the same App boundary. |
| Import into another App             | Create reconnect intent; server id and credential id from the package are not trusted.  |
| Run imported Agent before reconnect | Fail closed because no App-local credential proof exists.                               |

Legacy runtime ids such as package-scoped MCP server or credential ids are not ownership proof. They must not be used to derive access from package snapshots.

---

## 7. Fail-Closed Invariants

The product and implementation should keep these invariants aligned:

| Invariant                 | Required behavior                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| App id required       | MCP create, list, connect, update, delete, OAuth, registry, binding, and runtime APIs require explicit App proof. |
| Owner proof required      | The caller must own the App. A tenant people record is not enough.                                          |
| Server proof required     | The MCP server must belong to the requested App and to the current owner.                                         |
| Credential proof required | Secret reads require the credential row, server id, App id, scope, owner, auth type, and purpose to match.        |
| Runtime proof required    | Agent App, Session App, binding App, server App, and execution owner must match.                      |
| Package proof rejected    | Exported package snapshots and runtime ids are descriptive metadata, not authority.                                   |

When the system cannot prove one of these facts, it rejects the action instead of trying to infer a compatible path.

---

## 8. V1 Scope

In scope:

- Remote HTTPS MCP servers using Streamable HTTP.
- Bearer and OAuth credentials stored through the vault.
- App-local MCP server registry.
- App-local credential lifecycle.
- Agent Builder MCP binding to same-App servers.
- Runtime credential resolution for app-scoped and agent-scoped rows.
- Package export/import reconnect intent.

Out of scope for the current App product path:

- Local STDIO transport.
- Intranet tunnel setup.
- Connector marketplace.
- Global connector catalog.
- Tool-level allowlists.
- Human-role workflows.
- Cross-App connector reuse.
- Reverse LLM calls from an MCP server.
- Server-driven user prompts.

---

## 9. Protocol Notes

MCP is an open protocol (`https://modelcontextprotocol.io/`). The core model:

- **Tools** are executable functions the AI can call.
- **Resources** are data sources the server provides.
- **Prompts** are reusable templates.

Mosoo acts as MCP Host and Client for a running Agent. V1 uses only Streamable HTTP transport. V1 rejects Sampling and Elicitation: an MCP server cannot ask Mosoo for a reverse LLM completion, and it cannot open a new prompt flow to collect more user input.

---

This for-human version reflects the current App-owned MCP boundary. The implementation names the boundary App, while the console and product story use App.
