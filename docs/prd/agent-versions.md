# Agent Version History

Status: Available as read-only history. Restoring an earlier version is not shipped.

## Why it matters

Publishing an Agent can change how it behaves for people using the App. An App Owner needs to
know which configuration is live, recognize what changed, and understand whether an existing
session is affected. Version history provides that context without interrupting active work.

## Who uses it

This surface is for the App Owner who configures and publishes an Agent. App Users do not manage
Agent versions or need to understand them.

## Current user flow

1. Open an Agent from the App and select its draft or live-version badge.
2. Review the Versions sheet, ordered from newest to oldest.
3. Identify the live version and scan each entry's change summary, runtime, model, and publish
   time.
4. Start a new session knowing it uses the current live version. A session that already exists
   keeps the version it started with.

## Current availability and visible boundaries

The version list and live-version label are available today. The list is display-only: an owner
cannot open a complete historical configuration, compare two versions, see who published one, or
restore an earlier version from this surface.

Agent version history covers published Agent configuration. It is not the App's deployment
history, a session log, or a backup of runtime files, Agent state, or App data. Those records and
assets are not changed by viewing version history.
