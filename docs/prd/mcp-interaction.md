# MCP Connections

How a Project connects remote MCP servers to its Agents, and what a business MCP server receives from mosoo.

## Promises

- An MCP server is a remote HTTPS endpoint that belongs to one Project and authorizes with OAuth or a bearer token. The owner adds it, authorizes it, and selects it in the Agent editor.
- The authorization type is fixed after creation. Changing the server URL revokes the stored credential and requires authorizing again.
- OAuth authorization, token and registration endpoints must use HTTPS without URL credentials or fragments, and mosoo follows no redirects during discovery, token exchange or registration; providers must publish canonical endpoints.
- Only enabled, authorized servers are available to a run. Runtimes reach each server through mosoo's MCP proxy, which adds the stored credential on every request, so the Agent never sees it and revoking it takes effect at once.
- Stopping or replacing a Driver invalidates its MCP access grants immediately.
- When a Session has a `userId`, every proxied request carries an `X-Mosoo-Delegation` JWT naming the end user (`sub`), the Thread, the Run, the Agent and the Project (`act.app_id`). It is signed with HS256 under a key derived from the access token mosoo presents to that server, its audience is the server URL, and it lives 60 seconds; [`runtime-mcp-delegation.ts`](../../apps/api/src/modules/runtime/application/runtime-mcp-delegation.ts) defines the claims and the key derivation.

## Limits

- "Connected" means mosoo holds an active credential, not that the server or its tools work. There is no connection test or tool browser, so failures appear on first use.
- Selecting a server before authorizing it is allowed but makes no tools available.
- No local-process servers, cross-Project sharing, marketplace, or per-tool selection.
- The delegation JWT's `tool_call_id` claim is null for the calls runtimes make, so it cannot serve as a per-call idempotency key.
