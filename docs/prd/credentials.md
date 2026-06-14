# Credentials - for humans

> The Credentials product story for non-engineering readers. For interface details, schema names, and implementation checks, use the shipped Credentials contract and current Provider/MCP implementation.
>
> Adjacent PRDs: [`app-boundary`](./app-boundary.md), [`environment`](./environment.md), [`mcp-interaction`](./mcp-interaction.md), [`agent-type`](./agent-type.md).
>
> Current boundary note: V1 credentials are App-owned runtime dependencies. App is the implementation namespace; App is the product boundary. A Provider key or MCP secret must belong to one App, and runtime must resolve it from that same App boundary. Credential inheritance from outside the App and caller-specific key selection are not V1 product behavior.

---

## One-Line Positioning

> Store Provider and MCP secrets inside the active App, then let Agents in that App resolve only those secrets at runtime.

Credentials are how an App gives its Agents access to model providers and external tools without putting plaintext secrets into Agent profiles, packages, logs, diagnostics, or the Web UI. The App owner configures keys in the App, Agents reference providers or connectors, and runtime resolves the necessary secret only when an Agent run needs it.

The current product path is intentionally narrow: one owner, one App boundary, one App-local credential set.

---

## 1. User Problem

The App owner needs to answer four direct questions:

| Need                                                    | Product answer                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| "Can this App call OpenAI or Anthropic?"                | Add a Provider key in the active App's Providers surface.                                   |
| "Can this App use a custom OpenAI-compatible endpoint?" | Add an App-local custom Provider credential with a base URL and model list.                 |
| "Can this Agent use a connector?"                       | Configure the MCP server and secret inside the same App, then bind it to the Agent.         |
| "Can a package or imported Agent carry secrets?"        | No. Export only references and reconnect intent; configure secrets again in the target App. |

The owner should never need to choose a tenant pool, a caller key, or a person-specific runtime preference. If the App cannot prove a matching credential exists, the Agent should fail with a configuration error.

---

## 2. Credential Concepts

| Concept                 | Plain-language definition                                                                         | Boundary                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Provider Credential** | A named API key for one model provider, optionally with a custom endpoint and declared model ids. | Belongs to exactly one App.                                    |
| **MCP Credential**      | Bearer or OAuth material for one App-local MCP server.                                            | Belongs to the same App as the MCP server.                     |
| **Vault Secret**        | Encrypted secret payload referenced by a credential row.                                          | Read only through the owning credential row and purpose-specific checks. |
| **Agent Reference**     | An Agent's selected model/provider or MCP binding.                                                | References App-owned resources; it does not contain plaintext secrets.   |

Credential rows are metadata. The secret value lives in the vault and is addressed by a scoped secret kind. The UI may display masked values, never the raw stored secret.

---

## 3. Provider Key Journey

The active App owns the Providers surface:

```text
App
  Providers
    Add key
      Provider
      Name
      API key
      Optional base URL
      Optional model ids for OpenAI-compatible providers
    Test
    Save
```

Visible behavior:

| State                 | Meaning                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| **No key configured** | Agents that require this Provider cannot run that model yet.            |
| **Key saved**         | The App can resolve that Provider for Agents in the same App.           |
| **Test failed**       | The typed endpoint/key/model probe failed before or during save.        |
| **Needs reconnect**   | The stored key no longer unlocks or the provider rejects it at runtime. |

The App owner can create, edit, test, and delete keys. Delete destroys the credential row and its vault secret. There is no separate App default selector in V1; when multiple App credentials match a Provider, the current implementation resolves deterministically by the App's stored credential ordering.

---

## 4. Runtime Resolution

Runtime resolution uses App proof:

```text
Agent run
  -> Agent has App
  -> selected Provider or MCP binding has App
  -> credential row has matching App and provider/server
  -> vault secret kind matches the credential owner tuple
  -> plaintext secret is passed only to the runtime call
```

Provider key lookup is `(app, provider, optional model)`. MCP lookup is `(app, server, binding mode)`. The execution owner is the Agent owner; the caller or trigger source does not select a different Provider key in V1.

If no matching App credential exists, runtime returns no credential and the Agent run fails readiness or hydration. It must not search a tenant-level fallback, infer access from people records, or reuse an imported package id as ownership proof.

---

## 5. Secret Handling

Credentials are security-sensitive even in the single-owner V1 path.

| Rule                 | Required behavior                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| Plaintext scope      | Plaintext exists only during create/update/test/runtime read paths.                                  |
| UI display           | The UI may show a masked key, not the raw stored secret.                                             |
| Agent profile        | Agent config stores Provider/MCP references, not secret material.                                    |
| Package export       | Exported packages carry reconnect metadata, not secret rows or vault payloads.                       |
| Logs and diagnostics | Logs, runtime events, and readiness messages must not print raw keys.                                |
| Secret reads         | Reads require matching App, provider or MCP server, credential id, secret kind, and purpose. |
| Secret deletes       | Deletes require the same scoped owner tuple as the stored vault secret.                              |

When any proof is missing or mismatched, deny the read/delete or resolve no credential.

---

## 6. Fail-Closed Invariants

| Invariant               | Required behavior                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| App id required     | Provider list/create/test and MCP connect/list flows require explicit App proof.           |
| Owner proof required    | The caller must own the App. A tenant people record is not enough.                     |
| Provider proof required | A Provider credential must match the requested App and provider.                           |
| MCP proof required      | An MCP credential must match the requested App, server, binding shape, and secret purpose. |
| Runtime proof required  | Agent App, Session App, selected Provider/MCP, and credential App must match.      |
| Package proof rejected  | Runtime ids from packages are metadata only; they never grant credential access.               |
| Missing credential      | No App credential means no runtime secret. Do not fall back to another boundary.               |

These checks should be direct. Do not add compatibility adapters that derive credential authority from old tenant ownership, package snapshots, or access state.

---

## 7. Usage And Cost

Usage and cost attribution belong to the App first.

| Dimension    | V1 behavior                                                                    |
| ------------ | ------------------------------------------------------------------------------ |
| App  | Primary business dimension for usage and cost.                                 |
| Agent        | Runtime and delivery unit that incurred the usage.                             |
| Session Run  | Execution record for retries, failures, interrupts, and run-level attribution. |
| Organization | Billing rollup only.                                                           |
| Credential   | Not a V1 cost dimension.                                                       |

The system records provider/model usage, but it does not split cost by credential owner or caller identity.

---

## 8. Out Of Scope

The following are not V1 product behavior:

- Tenant-level Provider key pools.
- Person-scoped Provider keys.
- Caller-selected Provider keys.
- Caller-specific key selection.
- Provider key inheritance from tenant settings.
- Credential catalogs outside the App.
- Cross-person usage or cost reports.
- Provider-key governance roles.
- Automatic migration from legacy key ownership into runtime authority.

If one of these concepts is needed later, it should be reopened as a governance feature with a new data model instead of being hidden behind current App credential APIs.

---

## 9. Relationship To MCP Credentials

Provider keys and MCP credentials use the same security posture:

| Aspect           | Provider key                                                     | MCP credential                                     |
| ---------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| Product owner    | App                                                              | App                                                |
| Runtime consumer | Agent run                                                        | Agent MCP binding                                  |
| Secret storage   | Vault secret referenced by App credential row                    | Vault secret referenced by App MCP credential row  |
| Package behavior | Reconnect in target App                                          | Reconnect in target App                            |
| Failure mode     | Missing key blocks Provider/model readiness or runtime hydration | Missing secret blocks connector runtime resolution |

Both are runtime dependencies of Agents inside the App. Neither is an Organization resource pool.

---

This for-human version reflects the current App credential boundary. Older multi-scope credential stories are historical governance context and must not be used as V1 requirements.
