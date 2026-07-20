# Runtime Sessions

Status: available in the current Preview experience, with the limits below.

## Why this matters

An Agent configuration is useful only when a Builder can prove that it works. mosoo should make that proof quick and understandable: show whether the Agent is ready, stream real work, and distinguish a setup problem from an interrupted execution without requiring infrastructure knowledge.

## Who uses it

Builders and App Owners are the primary users. They configure and test an App's Agent before other people depend on it. App Users benefit from the result but should not need to know which runtime or provider powers the experience.

## User flow

1. Finish the Agent's required setup. Preview shows blockers before work starts and offers a direct fix when one exists.
2. Open Preview and send a representative request. If the configuration changed, reset the Preview chat first so the new setup is used.
3. Follow the visible state from Ready to Working and back to Ready. Review the streamed response, tool activity, and recorded file changes in the conversation.
4. Stop the work when needed. If it fails, read the visible reason, retry or resend when safe, reset the Preview chat, or open Logs for session diagnostics.

## Current availability

Preview runs real sessions for the runtime choices currently offered by mosoo; it is not a mock chat. The shipped surface covers readiness blockers, streaming responses, tool activity, cancellation, stopped sessions, and diagnostics. Live success still depends on valid setup and an available provider.

## User-visible boundaries

- Conversation history and recorded files can outlive an execution environment; temporary files and machine state do not automatically become durable assets.
- Assistant Agents keep bounded working continuity, while Task Agents use disposable environments. Neither is a promise of a complete machine backup.
- Existing sessions do not silently adopt later configuration changes.
- Interrupted requests are not silently replayed; the user may need to resend them.

Exact execution and persistence mechanics belong in [Architecture](../architecture.md).
