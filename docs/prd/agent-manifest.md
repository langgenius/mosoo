# Agent Manifest

Status: available in the current Alpha console. The [mosoo Spec](../SPEC.md) defines how this configuration fits the managed Agent runtime.

The unreleased #582 candidate treats the Manifest as an optional reusable preset.
Direct Project invocation does not require one. Candidate exports omit Pet/Cattle;
imports accept and discard a valid historical kind value, and also accept its absence.
Existing stored labels and admitted Session configurations are preserved.

## What problem it solves

An Agent needs a durable description of what it is and how it should behave. Without one, owners would have to manage each runtime's private files and remember which model, instructions, and integrations belong together.

The Agent Manifest is that saved description. It gives mosoo one user-readable source for configuring, testing, publishing, copying, and sharing an Agent. It is a product concept, not a file most users edit.

## Who uses it and how

A Project owner configures an Agent in Preview while testing it in the adjacent chat. The form covers identity and behavior—name, description, runtime, model, and system prompt—plus capabilities such as built-in tools, Skills, MCP servers, and an Environment. mosoo shows setup problems; missing required dependencies prevent Preview or Publish until repaired.

Owners can also:

- fork an Agent into a new draft within the same Project;
- export a portable `.agent` file;
- import a `.agent` file as a new draft in another Project.

## Current boundaries

Sharing preserves portable configuration, not a complete running machine. Credentials and secret values do not travel. Skills may be included, while MCP servers and Environments may need to be reconnected or selected after import. Forking does not copy sessions, usage history, logs, login state, or live runtime state.

The saved Manifest remains authoritative for future Session configuration. Changes
inside a Session workspace do not update the preset, and editing a preset does not
replace an admitted Session's frozen configuration. The candidate retires the shared
Agent Terminal at the coordinated Cloud cutover. Runtime-specific advanced settings
remain limited and are not portable between runtimes.
