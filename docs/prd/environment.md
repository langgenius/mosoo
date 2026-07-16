# Environment

Status: Partially available

## Why it exists

Agents often need the same tools and startup steps every time they run. An Environment lets an App owner save that setup once, so Agents start consistently without hiding installation instructions in prompts or repeating manual preparation for every Session.

## Who uses it

The App owner creates and manages Environments for Agents in one App. App Users do not configure them.

## Current user flow

1. On the Environments page, the owner creates a reusable setup with packages, a startup script, and environment variables.
2. The owner can make one Environment the App default. In the Agent editor, they can select another Environment or create one without leaving the flow.
3. When a new Session is created, mosoo captures the Environment selected at that moment. If the Agent has no explicit selection, mosoo uses the App default.
4. mosoo prepares exact-version npm and PyPI packages once, stores the isolated dependency prefix as a Sandbox Backup, and restores it before the Agent starts. The custom setup script then runs with those package paths available. A package build, restore, script, or required variable failure prevents startup rather than running with an incomplete setup.
5. Later Environment edits apply only to Sessions created afterward; an in-progress Session keeps the version it started with.

## What works today

The Web UI supports listing, searching, creating, editing, setting a default, and selecting an Environment. Owners can request deletion, but an App default or an Environment still used by an Agent is protected. There is no duplicate or cross-App reuse action in the current UI.

New package declarations currently support `npm` and `pip`. The maintained Driver image verifies both tools during its build. Older revisions that contain `apt`, `cargo`, `gem`, or `go` remain readable, but the editor requires owners to remove or replace those declarations before saving a new revision; Runtime rejects them before allocating a Sandbox rather than failing later on a missing executable. System packages belong in the platform Driver image instead of App-local Environment declarations.

Secret values are encrypted after saving. The editor shows only a masked hint for an existing value, never the full stored value; leaving it blank preserves it.

Package declarations accept public npm and PyPI packages with exact versions. They are prepared asynchronously and reused within the same App when the declarations and artifact ABI are unchanged. A Session freezes its package declarations, so later Environment edits do not change an existing Session. Package managers never run on the Task provisioning hot path, and mosoo does not fall back to runtime installation when an artifact is unavailable.

npm artifacts expose package CLIs through `PATH` and CommonJS packages through `NODE_PATH`. Node.js ESM bare imports do not use `NODE_PATH`; projects that need `import "package"` must install that dependency in the project itself. PyPI artifacts expose console scripts through `PATH` and modules through `PYTHONPATH`.

OS packages belong in the maintained Driver image. `apt`, Cargo, RubyGems, and Go module installation are not writable Environment package options. The setup script is a per-Sandbox hook for custom initialization after prepared packages are restored; it is not persistent dependency storage.

Networking controls are visible but are saved labels only. They do not currently restrict an Agent's network traffic. “Limited,” allowed hosts, and related switches must not be treated as security protection.
