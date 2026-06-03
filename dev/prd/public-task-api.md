# Public Thread API — for humans

> This is the product-story version for non-engineering readers. For the single source of truth on the product contract, see [`./published-agent-api-surface.md`](./published-agent-api-surface.md). The history of what was removed is no longer tracked in a separate draft.
>
> The file is still named `public-task-api` only to keep old links readable. As of 2026-05-28, the standalone Public Task API has been retired, and the Published Agent API adopts **Thread-first** language directly.

## 1. In one sentence

The Public Thread API lets external systems invoke a Published Agent and receive a **Thread** they can continue, view, archive, and review.

The old Public Task API tried to solve "don't make developers understand Session mechanics on day one." That direction was right, but the `Task` wrapper was too thin: it created a Session, surfaced Session / Run status, and then every real interaction fell back to the Session or the Web Thread. In the end users had to understand four nouns at once — Task, Session, Run, and Thread.

The decision now is: the external API creates a Thread directly. A Thread is still implemented by an AgentSession underneath, but the public language no longer exposes the internal Session axis.

## 2. What users want to do

- "Have this Agent do one thing."
- "I want to be able to continue this work later."
- "Attribute this call to a specific user so they can see it in their Threads."
- "My backend may retry — please don't run it twice."
- "I want to carry a ticket / issue / event id from my customer's system, so I can look it up later."

None of these require a separate Task object. They require a trackable, continuable Thread.

## 3. Core mental model

| Noun                  | Plain-language explanation                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Thread                | Where this work continues, gets viewed, and gets resumed. This is what API users create.                                            |
| Run                   | A single execution of the Agent. A new Thread starts the first Run; later follow-up input triggers a new Run.                       |
| AgentSession          | The internal implementation name. It still exists in engineering, but it should not be the first-screen language of the public API. |
| Service token         | The machine-caller identity used by customer backends / automations.                                                                |
| `attributed_user_id`  | The field a service token uses to explicitly attribute a Thread to a human user.                                                    |
| `client_external_ref` | A correlation ID from the customer's system, e.g. a Linear issue or a support ticket.                                               |

## 4. API shape

The first screen should be:

```text
POST /api/v1/agents/{agentId}/threads
GET  /api/v1/threads/{threadId}
```

The body for creating a Thread stays simple:

```json
{
  "input": {
    "type": "user.message",
    "content": [{ "type": "text", "text": "Review this launch plan." }]
  },
  "files": [{ "file_id": "file_tmp_..." }],
  "attributed_user_id": "usr_...",
  "client_external_ref": "linear-ENG-123"
}
```

The response should center on the Thread and the Run:

```json
{
  "thread": {
    "id": "thread_...",
    "status": "running",
    "agent_id": "agent_...",
    "last_run_id": "run_...",
    "client_external_ref": "linear-ENG-123"
  },
  "run": {
    "id": "run_...",
    "status": "queued"
  },
  "links": {
    "thread": "/threads/thread_..."
  }
}
```

## 5. Attribution rules

| Caller                               | Thread ownership         | Enters private Threads?                       |
| ------------------------------------ | ------------------------ | --------------------------------------------- |
| Human PAT                            | PAT owner                | Yes — enters this user's Threads.             |
| Service token + `attributed_user_id` | The specified human user | Yes — enters the target user's Threads.       |
| Service token + no attribution       | No human user            | No — does not enter anyone's private Threads. |

`attributed_user_id` is not impersonation. It only determines product attribution and visibility. It does not turn the machine token into the target user, and it does not grant access to the target user's private credentials or file permissions.

## 6. Relationship to Channels

Channels such as Slack / Lark / Discord / Telegram / WeChat do not go through the Public Thread API.

A Channel is an entry point into an external collaboration platform. It uses its own binding, signature verification, and external thread id to create or reuse an AgentSession inside Mosoo, and then writes the result back to the originating platform. It does not consume a PAT / Service token, and it does not automatically project an external user into a Mosoo user's private Thread.

So this boundary still holds:

```text
External developers / SaaS / CLI -> Public Thread API
Slack / Lark / Discord / WeChat  -> Channel binding + internal session path
Web users                        -> /threads
```

## 7. Why we retired Task

`Task` sounds like an object that would have its own status, list, lifecycle, comments, collaboration, and notifications. But the v1.3 Task was just a status card; all the real continuation, confirmation, archiving, cancellation, and deletion fell back to the Session / Thread.

This made the product language more complex without giving users any new capability. The Thread is already where users go to continue work, so the public API should deliver a Thread directly.

## 8. What deletion means

The current code already contains the `/tasks` route, the `public_api_task` table, the OpenAPI schema, tests, and publishing-panel copy. These are not the future product truth, and there's no need to keep a compatibility layer for nonexistent production users.

Delete the following outright before release:

- New docs, new CLI, and new PRDs use only `threads`.
- `/tasks` is not kept as an alias, a deprecated surface, or a shadow route.
- Thin wrappers like `TaskSummary`, Task links, and Task next action no longer appear in the OpenAPI.
- The future designs for Channel, System Agent, and CLI are not bound to the Task concept.

## 9. Decision boundaries

| Question                                 | Conclusion                          |
| ---------------------------------------- | ----------------------------------- |
| Public create-work noun                  | Thread                              |
| Public retrieve noun                     | Thread                              |
| Old Session API public naming            | Migrated to Thread API naming       |
| Internal implementation name             | AgentSession may continue to exist  |
| Keep Task as a product object?           | No                                  |
| Does Channel call the Public Thread API? | No                                  |
| Long-term CLI command                    | `threads`, not `tasks` / `sessions` |
