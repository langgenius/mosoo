# Thread Lifecycle

## Why this matters

A Thread keeps the conversation, saved files, and outcome of an Agent task together across
individual attempts. Its lifecycle should tell a user when work is still active, when it can be
continued, and when data will disappear.

## Who it serves

Builders use Threads in Preview and the Console. App integrations use the same lifecycle when
they create or continue work for an end user.

## User flow

1. A user starts a Thread and sends a task. While the Agent is working, output appears in the
   conversation.
2. In Preview or live chat, **Stop generating** ends the current attempt. The Thread remains
   available for another message. Stopping cannot undo tool calls or other external side effects
   that already happened.
3. When an attempt completes or fails, the conversation and saved files remain readable. The
   user can send a follow-up. Preview offers retry actions for some provider checks and send
   failures. After an unexpected runtime loss, Mosoo reports the failure but does not
   automatically replay the request; the user must deliberately resend it.
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
