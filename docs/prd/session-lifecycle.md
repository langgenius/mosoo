# Thread Lifecycle

## Why this matters

A Thread keeps the conversation, saved files, and outcome of an Agent task together across
individual attempts. Its lifecycle should tell a user when work is still active, when it can be
continued, and when data will disappear.

## Who it serves

Builders use Threads in Preview and the Console. Project integrations use the same lifecycle when
they create or continue work for an end user.

## User flow

Viewing history or reconnecting its event stream does not wake the Sandbox. Explicit
composer activity may prewarm it; sending a task activates it when needed.
Maintenance retries missing checkpoints for idle completed turns before reclamation;
a failed backup keeps the resident workspace available for another attempt.

1. A user starts a Thread and sends a task. While the Agent is working, output appears in the
   conversation.
2. In Preview or live chat, **Stop generating** ends the current attempt. The Thread remains
   available for another message. Stopping cannot undo tool calls or other external side effects
   that already happened.
3. When an attempt completes or fails, the conversation and saved files remain readable. A
   Task Agent also commits its private Thread workspace after a successful turn and before a
   follow-up or runtime recycle, so a later follow-up resumes the last committed turn instead
   of an empty workspace. The user can send a follow-up. Preview offers retry actions for some
   provider checks and send
   failures. After an unexpected runtime loss, mosoo reports the failure but does not
   automatically replay the request; the user must deliberately resend it. If the Run had a
   write-capable external tool call whose final receipt was lost, Mosoo records the effect as
   **unknown** and blocks automatic replay; an operator or the user must explicitly resolve it.
   The error includes the durable effect id. For generic MCP servers, Mosoo sends a stable
   idempotency key in request metadata and retains any returned metadata as an opaque provider
   receipt, but MCP defines no universal receipt lookup or compensation protocol. Mosoo therefore
   never infers that an unknown effect is safe to retry: creating another external action is a
   deliberate user or operator decision, not recovery automation.
4. **Archive** moves the Thread out of active work. Its history and saved files stay readable,
   but messages and file changes are blocked. In the Console, sending a follow-up restores the
   Thread first. Archiving also asks active work to stop; if cleanup fails, the Thread can already
   appear archived before every connection has closed.
5. In the Console, **Delete** asks for confirmation and permanently removes the Thread, its
   history, and its saved files. It cannot be restored.
6. A permanently stopped Thread remains readable but cannot be continued or restored. The user
   must create a new Thread; deletion remains available.

## Available now

Archive, restore-through-follow-up, permanent deletion, stop, and readable history are shipped
in the Console and public integrations. Recovery is partial: retry actions exist for selected
Preview failures, while automatic replay after runtime loss is not shipped. Existing Threads
keep the Agent configuration captured when they began; testing newer configuration requires a
new Thread or Preview session.

## Cloud debug Preview retention (unreleased)

Cloud debug Previews have one inactivity period: **30 days**. A Preview can be continued
within that period. Sending a message, running work, or writing/uploading a file renews it;
reading history, opening the console, and background maintenance do not. After 30 days
without debugging activity, the Preview and its history/files may be permanently cleaned
up. Returning to the draft starts a new Preview. There is no separate three-day deadline.
Running work and admitted uploads must finish or expire before cleanup can claim a Preview.

This rule does not expire formal conversations or API-used Sessions, regardless of a legacy
`preview` label. Self-hosted installations retain their existing behavior. New Cloud debug
Previews record the policy at creation. Existing Previews remain unchanged until a reviewed
inventory, backup/restore plan, and approved production cutover enroll them. Agent definitions
remain available after Preview cleanup. Deploy rollback alone cannot restore deleted data.

## Inactive legacy Sessions (unreleased migration only)

For this migration, an old Pet Session with no calls or file activity in the preceding
30 days may become read-only, even when its account remains active. Publication and
account activity still describe impact; the Session's own activity determines eligibility.
Keep history and saved files readable. Returning users can start a new Session directly
or with an existing Agent preset; the old execution context, workspace and unrecorded
configuration need not be recovered for the reviewed inactive cohort.

This is a one-time, explicitly reviewed cohort, not automatic expiry of formal Sessions.
Refresh ownership, all Run outcomes, file uploads/edits/deletes and pending work before
cutover; active or uncertain cases keep the seamless continuation requirement. Login,
history reads and maintenance do not renew Session activity. Stale maintenance or model
telemetry records require evidence and guarded reconciliation. Reuse the
existing stopped Session capabilities and new-Session entry point. Debug Preview retains
its separate 30-day policy. Production changes still require a backup and rollback plan
and explicit approval; this decision does not authorize deleting retained data or shared
execution resources.
