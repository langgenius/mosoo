# MCP Connections

Status: available in the console for App-owned remote MCP servers and Agent use.

## Why It Matters

Mosoo Agents become more useful when they can act in products such as GitHub, Linear, or a Builder's own server. An App owner should connect once, share it with selected Agents, and keep credentials out of Agent configuration.

## Who It Is For

The Builder who owns an App configures MCP. App Users benefit when an Agent uses those tools, but do not manage connections.

## User Flow

1. In **MCP servers**, the App owner adds a name and remote HTTPS address, then chooses OAuth or a bearer token.
2. Saving immediately starts authorization. OAuth opens the provider's page; bearer authorization asks for a token.
3. In the Agent editor, the owner selects one or more MCP servers from the same App and saves the Agent.
4. The owner tests it by asking the Agent to use it in Preview or a new Session. Only enabled, authorized connections are available during a run.
5. The owner can later edit, disable, reconnect, revoke, or delete a connection. Its authorization type cannot be changed. Changing its address disconnects the existing credential and requires authorization again.

## Current Availability and Boundaries

The complete add-to-use path is available for remote HTTPS MCP servers. Binding before authorization is allowed, but does not make tools usable.

“Connected” means Mosoo has an active stored credential; it does not prove the server or its tools work. There is no standalone connection test or tool browser, so failures appear when an Agent first uses the server.

Credentials are encrypted, are never shown again after entry, and stay inside their App. Mosoo gives Agents temporary, connection-specific access rather than revealing the stored secret. Exporting or forking an Agent does not carry credentials; the destination App must reconnect. Local-process servers, cross-App sharing, a connector marketplace, and tool-level selection are not available.
