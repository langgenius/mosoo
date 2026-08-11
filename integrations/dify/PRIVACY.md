# mosoo Dify Plugin Privacy Policy

Last updated: August 11, 2026

The mosoo Dify Plugin connects a Dify Agent, Chatflow, or Workflow to a published mosoo Agent.

## Data processed

- Dify stores the mosoo API token and Agent ID as provider credentials. The plugin reads them only when validating credentials or invoking the tool.
- The plugin sends the task text, an opaque Dify user identifier, and an optional mosoo Thread ID to `https://cloud.mosoo.ai/api/v1`.
- mosoo returns Thread and Run metadata plus the Agent's canonical final answer.

## Storage and logging

The plugin has no persistent storage, analytics, advertising, or telemetry of its own. It does not intentionally log credentials or task content. Dify and mosoo may retain operational logs according to their own policies. mosoo stores Threads, Runs, events, and Agent artifacts needed to provide the managed Agent service.

## Third parties and execution boundary

The plugin sends data only to mosoo Cloud. It does not accept a custom API origin and does not send the mosoo token to model providers directly. The selected mosoo Agent may use its configured model provider, tools, MCP servers, network access, or sandbox to perform the requested task. Configure those capabilities in mosoo before publishing the Agent.

## Control and deletion

Revoke the API token at [mosoo Access Tokens](https://cloud.mosoo.ai/settings/access-tokens). Manage or delete Threads and Agent data in mosoo. Remove the provider credential or uninstall the plugin in Dify to stop future access.

Questions: [open an issue in langgenius/mosoo](https://github.com/langgenius/mosoo/issues).
