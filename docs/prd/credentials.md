# Credentials

How a Project's provider keys and MCP credentials are stored and used.

## Promises

- Credentials belong to one Project and are managed only by its owner. A run uses only a credential of its own Project; if none matches, setup or the run stops with a configuration error instead of borrowing another Project's secret.
- Secrets are encrypted at rest. A saved provider key is shown only masked, and an MCP token is never shown again.
- Raw keys never enter the Sandbox ([SPEC](../SPEC.md) section 5). Runtimes reach models through mosoo's LLM proxy, which reads the key on every call, so editing or deleting a key takes effect at once, even in running Sessions.
- With several keys for one provider, runs use the provider's default key; the first key added becomes the default. A custom model resolves to the custom credential that declares it.
- A custom provider has a public HTTPS endpoint (never a local, private, metadata or credential-bearing URL), at least one model ID, and one model protocol ([Runtime choice](./runtime-catalog.md)). Its provider ID in the API stays `openai-compatible`.
- Exports and forks never carry credentials or secret values. An exported `.agent` file blanks secret Environment values, and importing or forking an Agent requires reconnecting its MCP servers.

## Limits

- No organization-wide pool, personal key, caller-selected key or cross-Project inheritance.
- The connection test is optional and does not gate saving. Testing a model calls only that model's protocol endpoint, so passing it does not prove streaming or tool-call support.
