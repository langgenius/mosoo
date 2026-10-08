# Legacy Agent Terminal

Status: removed from the Session-only product candidate for #582. The deployed legacy
surface remains unchanged until the approved Cloud cutover.

The former owner Terminal connected to a shared Agent machine. A saved Agent is now
configuration for future Sessions and owns no running machine. The old Agent tab and
WebSocket route therefore retire with the shared runtime. This release does not add
a separate interactive Session terminal.

Owners can inspect Session history and saved files, or explicitly restart/recreate
one Session while retaining its committed workspace and native context. Existing
Cloud Sessions must be qualified and converted before the final candidate replaces
the shared runtime; removing this surface is not migration evidence. See
[Agent runtime model](./agent-type.md) and the
[Session isolation transition](../session-isolation-transition.md).
