# Credentials

Status: Shipped for Provider keys and MCP connections in the current single-owner App experience.

## Why It Matters

An Agent often needs a model provider or external tool to do useful work. Credentials let the App owner connect those services without copying secret values into Agent settings, exported packages, or everyday troubleshooting output.

## Who Uses It

The App owner manages credentials. Agents in that same App may use them when their provider or MCP connection is selected. People who trigger or use the Agent do not see or choose the underlying secret.

## User Flow

1. Open the active App's Providers or MCP servers page.
2. Add the provider key or authorize the MCP connection. Provider keys can be named, edited, tested, chosen as the default, and deleted. MCP connections can be connected, revoked, disabled, edited, and deleted.
3. Select the provider and model or MCP connection while configuring an Agent.
4. Run the Agent. Mosoo supplies only a matching credential from that App. If none exists, or ownership does not match, setup or the run stops with a configuration error instead of using another App's secret.
5. When moving an Agent package to another App, reconnect credentials there; packages do not carry secrets.

## Current Availability and Boundaries

Provider keys and remote MCP credentials are available now, including custom provider endpoints. Custom OpenAI-compatible credentials can run through OpenCode, or through OpenAI Runtime when the endpoint implements the Responses API. A connection test is optional and does not make saving conditional on success.

Credentials belong to one App and can be managed only by its owner. There is no organization-wide pool, personal key selection, caller-selected key, or cross-App inheritance.

Secrets are encrypted at rest. Saved Provider keys appear only in masked form, and saved MCP tokens are not shown again. Plaintext is limited to entry, explicit testing, authorization, and the Agent action that needs it. Agent settings, packages, logs, and diagnostics must not expose raw secrets.
