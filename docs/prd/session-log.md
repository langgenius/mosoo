# Session Log

Status: available in the current Mosoo console under each Agent's Logs tab.

## Why it matters

Builders need a fast way to understand what happened when an Agent produced an
unexpected answer, used the wrong tool, stalled, or failed. Session Log turns a
long conversation into a scan-friendly replay so the owner can find the
problematic turn and inspect it without recreating the run.

## Who it serves

The primary user is the App owner or Builder operating an Agent in Preview or
after it has handled real work. It is designed for troubleshooting individual
Sessions, not for App Users or finance and compliance teams.

## Current user flow

1. Open an Agent and choose **Logs**. The page lists recent Sessions with their
   status, runtime, model, and last activity.
2. Select a Session to open its replay. Activity is grouped into Turn cards so
   the owner can scan completed, running, failed, or interrupted work.
3. Filter the feed by user, Agent, or Session activity, or narrow it to items
   that need attention.
4. Select an activity row to inspect its recorded content, timing, and status.
5. Expand **Diagnostics** to review the execution context recorded for that
   Session.

## Current boundaries

Session Log is a troubleshooting replay, not a complete audit trail or billing
record. It does not promise every internal system action, and usage updates are
not shown as activity rows. Lists and replays show a recent subset and warn when
older activity is hidden. There is no cross-Session search, pagination, or
full-Session export today. Token figures are diagnostic hints, not priced
spend; use App Usage for cost review.
Deleting a Session also removes this replay, so it must not be used for
compliance retention.
