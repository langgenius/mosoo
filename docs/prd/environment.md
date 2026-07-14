# Environment

Status: Partially available

## Why it exists

Agents often need the same tools and startup steps every time they run. An Environment lets an App owner save that setup once, so Agents start consistently without hiding installation instructions in prompts or repeating manual preparation for every Session.

## Who uses it

The App owner creates and manages Environments for Agents in one App. App Users do not configure them.

## Current user flow

1. On the Environments page, the owner creates a reusable setup with packages, a startup script, and environment variables.
2. The owner can make one Environment the App default. In the Agent editor, they can select another Environment or create one without leaving the flow.
3. When a new Session is created, Mosoo captures the Environment selected at that moment. If the Agent has no explicit selection, Mosoo uses the App default.
4. Before the Agent starts, Mosoo installs the packages, runs the startup script, and supplies the saved variables. A failed installation or script, or a variable with no saved value, prevents startup rather than running with an incomplete setup.
5. Later Environment edits apply only to Sessions created afterward; an in-progress Session keeps the version it started with.

## What works today

The Web UI supports listing, searching, creating, editing, setting a default, and selecting an Environment. Owners can request deletion, but an App default or an Environment still used by an Agent is protected. There is no duplicate or cross-App reuse action in the current UI.

Secret values are encrypted after saving. The editor shows only a masked hint for an existing value, never the full stored value; leaving it blank preserves it.

Networking controls are visible but are saved labels only. They do not currently restrict an Agent's network traffic. “Limited,” allowed hosts, and related switches must not be treated as security protection.
