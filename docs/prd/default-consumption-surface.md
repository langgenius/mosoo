# Runs and Logs

Where a Project owner sees Session work in the console: the **Runs** inbox for Threads, and an Agent's **Logs** tab for troubleshooting.

## Promises

- The sidebar entry **Runs** opens the **Threads** page, and **New thread** starts one for a chosen Agent. A Thread holds one Run per turn, so a follow-up adds a Run to the same Thread.
- Runs lists the Project's Threads, including those created through the API; Previews are not listed. A Thread without an Agent is labelled **Direct invocation**.
- Threads are grouped into Pinned, Working, Completed and Archive and can be filtered to unread, pinned or failed. A Thread shows its request, replies, status and an on-demand process view, and can be followed up, pinned, archived or deleted ([Thread lifecycle](./session-lifecycle.md)).
- **Agent → Logs** lists that Agent's Sessions, Previews included, and replays one Session turn by turn, with a **Diagnostics** panel for its execution configuration.
- Logs is a troubleshooting replay, not an audit trail or a billing record; use [Project usage](./cost-dashboard.md) for cost. Deleting a Session deletes its replay.

## Limits

- **New thread** offers only published Agents. Threads for unpublished presets or with no Agent come from the API.
- Pins and read markers live in the current browser and do not sync across devices.
- Completion notifications need browser permission and work only while the Threads page is open.
- Logs has no cross-Session search, pagination or export, and Sessions without an Agent have no Logs view.
