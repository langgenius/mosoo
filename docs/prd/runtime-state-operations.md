# Runtime State Operations

Status: Apply Changes and Reset agent-state are available in the web console. Hibernate is automatic, not a user action.

## Why This Matters

Builders need to improve a live Agent without guessing whether conversations will change or work will be lost. mosoo separates routine saves, interruption, sandbox replacement, and destructive recovery so risk is visible before action.

## Current User Flow

- Edits that need no Assistant runtime action save automatically. Existing conversations keep their original settings; new conversations use the saved settings.
- For a published Assistant Agent, runtime-impacting edits show **Apply changes** in Preview. Confirmation explains whether mosoo will restart the Agent process or recreate the sandbox. Either action can cancel running work.
- Restart keeps the current sandbox and stops the current Agent process. It starts again on later use.
- Recreate first checkpoints long-term memory and eligible, non-terminated conversation workspaces, then removes the sandbox. Recovery occurs when the Agent is next used. A failed checkpoint prevents removal of the old sandbox.
- **Reset agent-state** appears only for Assistant Agents under Settings > Danger zone. The Builder must type the Agent name to confirm.
- After publication, Agent type and runtime cannot change in place. The Builder must fork; the original keeps its conversations and history.

## Safety And Visible Boundaries

Reset is irreversible once clearing begins. It removes long-term memory, per-conversation runtime state, and stored vendor resume references for affected conversations, then destroys the sandbox, including local logins, caches, installed packages, and other files outside eligible checkpointed conversation workspaces. Agent settings, Skills, connected tools and credentials, explicit conversation files, transcripts, logs, and cost history remain. If Reset fails after clearing starts, some state may already be gone.

There is no Hibernate button. mosoo may automatically recycle an idle Assistant sandbox using the same checkpoint boundary as Recreate. Task Agent sandboxes are temporary and are recycled after each run without Assistant-style runtime-state continuity.
