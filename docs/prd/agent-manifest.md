# Agent Manifest

Status: available in the current alpha console. Mosoo's launch product direction is defined by the [Mosoo Spec](../SPEC.md); this page explains the Agent configuration people can use today.

## What problem it solves

An Agent needs a durable description of what it is and how it should behave. Without one, owners would have to manage each runtime's private files and remember which model, instructions, and integrations belong together.

The Agent Manifest is that saved description. It gives Mosoo one user-readable source for configuring, testing, publishing, copying, and sharing an Agent. It is a product concept, not a file most users edit.

## Who uses it and how

An App owner configures an Agent in Preview while testing it in the adjacent chat. The form covers identity and behavior—name, description, runtime, model, and system prompt—plus capabilities such as built-in tools, Skills, MCP servers, and an Environment. Mosoo shows setup problems; missing required dependencies prevent Preview or Publish until repaired.

Owners can also:

- fork an Agent into a new draft within the same App;
- export a portable `.agent` file;
- import a `.agent` file as a new draft in another App.

## Current boundaries

Sharing preserves portable configuration, not a complete running machine. Credentials and secret values do not travel. Skills may be included, while MCP servers and Environments may need to be reconnected or selected after import. Forking does not copy sessions, usage history, logs, login state, or live runtime state.

The saved Manifest remains authoritative for Mosoo-managed updates. Changes made directly inside a Pet Agent's debug Terminal are not written back, and the current console does not compare or adopt that runtime state. Runtime-specific advanced settings are limited and are not portable between runtimes.
