# Runs and Threads

Status: available in the current mosoo web console as the human-facing view of managed Agent work.

## Product value

Runs is mosoo's built-in task inbox. It lets an App owner send meaningful work to an Agent, leave while it runs, then return to review or continue it without connecting another channel.

The sidebar entry is **Runs**. Inside that surface, each task is a **Thread**: the page title is **Threads**, creation says **New thread**, and detail views keep the Thread name. A Thread can contain another execution when the user follows up.

## Problem and users

The primary user is an App owner or operator who already has an Agent and needs to manage work that may take longer than a live chat. They need a task-first place to see what is still working, what completed or failed, and what needs attention.

## User flow

1. Open **Runs** from the App sidebar.
2. Select **New thread**, choose a published Agent, write a brief, and optionally attach files. A published Agent can also open this composer with that Agent already selected.
3. Scan Pinned, Working, Completed, and Archive sections, or filter for unread, pinned, or failed work.
4. Open a Thread to review the original request, Agent replies, status, and an on-demand process view.
5. When the Thread allows it, add a follow-up. The user can also pin, archive, or permanently delete a Thread.

## Current user-visible boundaries

- Threads belong to the active App, and only published Agents can receive a new Thread.
- Some finished or archived Threads are read-only; the detail view explains when follow-up is unavailable.
- Files can be attached when creating a Thread, but not from the follow-up composer.
- Pins and read markers stay in the current browser rather than syncing across devices.
- Completion notifications require browser permission and only work while the Threads page is open.
