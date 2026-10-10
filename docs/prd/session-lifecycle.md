# Thread Lifecycle

What happens to a Thread (one durable Session) between turns, when a user stops, archives or deletes it, and when a debug Preview expires. Turn rules, the turn time limit, capacity failures and the continuation promise are in [SPEC](../SPEC.md) section 4.

## Promises

- Reading history or reconnecting to events never wakes the Sandbox. Creating a Thread, or typing in a console composer, may prewarm it; sending input starts it when needed.
- A Sandbox left idle for `SESSION_RUNTIME_IDLE_GRACE_MS` is reclaimed automatically, and the next input restores the last committed native conversation on a fresh one.
  Recovery verifies the saved native records before running the model.
- **Stop** ends only the current turn; the Thread stays continuable.
- A Thread keeps the configuration it was created with; saved Agent changes reach only new Threads. Preview says when newer changes exist, and **Reset chat** starts a new Preview with them.
- Preview runs an ordinary Session on the real runtime. Before work starts it shows readiness blockers, such as a missing provider key, with a fix where one exists.
- **Restart execution** and **Recreate environment** (Session maintenance) act on one Session only and keep its ID, frozen configuration, and last committed workspace archive and native conversation.
  They are refused until the last successful turn's checkpoint is committed.
  Rebuilding the native conversation preserves an existing nonempty workspace; user files are not guaranteed to form a transactional snapshot of the turn.
- **Archive** stops active work and makes the Thread read-only until it is unarchived: history and files stay readable, while input and file changes are rejected. In the console, sending a follow-up unarchives first.
- **Delete** is permanent and removes the Thread's history, files and checkpoints.

## Debug Preview retention

- A console debug Preview expires after **30 days** without debugging activity (`PREVIEW_RETENTION_MS`). Sending a message, running work, or uploading or changing a file renews it; reading history, logging in and background maintenance do not.
- Once it expires, the Preview with its history and files may be deleted, and returning to the Agent starts a new Preview.
- A Preview is enrolled when the console creates it. Threads in Runs, Sessions created through the API, and any Preview that an API key has run never expire. Running work and admitted uploads finish before cleanup can claim a Preview.

## Limits

- A native runtime reset invalidates the previous saved conversation once the host acknowledges it.
  The live runtime can continue, but restart and cold recovery remain unavailable until the next successful turn saves a new native checkpoint.
  Recovery never returns to the conversation from before the reset.
- Older saved conversations require a verified migration before the new runtime can resume them.
  If their saved boundary cannot be verified, their data remains preserved on a compatible deployment.

- A failed or interrupted turn is never replayed automatically, including after a runtime loss or a provider content block; the user resends deliberately. Stopping or failing a turn never undoes tool actions that already ran.
- Session maintenance stops any current turn, and that turn's uncommitted work may be lost. It is refused for archived or terminated Sessions.
- A terminated Thread stays readable but cannot be continued; start a new one.
