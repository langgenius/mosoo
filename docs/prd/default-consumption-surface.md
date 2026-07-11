# Default Consumption Surface (Threads) — for humans

Status: active and shipped for the current Runs/Threads list and detail UI. The
three buckets are presentation states, not the lifecycle authority. The sidebar
label is **Runs**; Thread remains the resource noun and `/threads` remains the
route. [Session Lifecycle](./session-lifecycle.md) owns archive/termination
semantics and capabilities.

> A product-narrative version for non-engineer readers.
>
> This describes Mosoo WebUI's default consumption surface for App-local Agents: the UI page is called **Threads**, and a single instance is a **Thread**. In V1, Threads creates or resumes Agent-owned Sessions inside the active App; Agent API Endpoints and Channels are separate Agent Exposure surfaces.

> **Current UI status**: the sidebar is App **Overview / Runs / Agents / Config**
> plus account **Settings**. The global primary action is `New agent` and points
> to `/agent?create=1`. The standard `New thread` action lives on the `/threads`
> page header / empty state; the Agent-locked compose variant remains reachable
> through the Agent **Publish → Distribution → Thread** action and the
> publish-success surface.
>
> **Current App boundary note**: Threads are App-local consumption resources. New routing and data modeling should make Threads / Sessions inherit App from the selected Agent/App rather than treating `/threads` as a global Organization root. See [App Boundary](./app-boundary.md).

---

## 0. One-line positioning

Threads is Mosoo's built-in **asynchronous consumption plane**: on a single page,
the user completes the loop of "dispatch a task → wait for the result → review
the result," and follows up when lifecycle capabilities allow. A terminal
Buried Thread remains read-only and requires a new Thread. It works **like
writing email to an AI** — you write a structured brief, return to the task
list, and review or continue later.

### Why "email-style" rather than chat-style

In the long run, the conversation surfaces on the market will converge into two camps:

1. **IM / Channel model** — Slack / Lark / GitHub Issues / Linear. Conversations are organized around "topic streams" and "groups of people."
2. **ChatGPT model** — ChatGPT / Codex / Claude Code. Conversations are organized around "a single Q&A" or "a single task run."

People who work inside a company don't need 1,000 also-ran apps stacked on top of each other doing the same thing. Threads doesn't invent yet another chat paradigm; instead it **picks the right container for the "20-minute to 3-hour asynchronous task."** That container is closer to a hybrid of a Linear ticket and Gmail than to an IM window.

That's why the v1 investment is deliberately restrained: don't fight for the synchronous chat market, don't build LLM-decoration features, don't build a team-collaboration board. A single-field compose + a three-state machine + an in-product inbox is enough.

> **TL;DR** — Threads is Mosoo's built-in "write email to an AI" asynchronous task plane. It is a deliberately restrained product form that doesn't take ChatGPT or IM head-on.

---

## 1. User problem

The reader: an **App owner / operator** — someone who has configured one or more Agents inside an App, may expose an Agent through an Agent API Endpoint or Channel, and needs to continuously dispatch tasks and review Thread results from the web client.

Current pain points:

- **Entry-point mismatch** — the existing ChatUI is _agent-first_ (you pick an agent first, then open a session), but the user's mental subject is the _task_ ("how did last week's codec-fix run go?"), not the _agent_ ("where did I leave off chatting with codec-fixer?").
- **Form-factor mismatch** — ChatUI uses a synchronous IM metaphor to carry long-running tasks that take 20 minutes to 3 hours; the narrow composer implies "type a line or two and send," which is the opposite of the "write a structured brief" that an asynchronous task needs.
- **Status blind spot** — completed / working / failed are not visually distinguished in ChatUI; the user can't tell at a glance whether an agent has finished, failed, or is still running.
- **Process black box** — the user doesn't know what the agent is doing and can only guess intuitively at "whether it's stuck."
- **No cross-channel fallback** — when external channels such as Slack / Linear / GitHub aren't connected, the user has no self-contained consumption entry point.

The result is that when the user returns to Mosoo, they don't know where to look for their own work, and Agent reuse inside the active App is held back by UX.

> **TL;DR** — Mosoo provides a task-first, three-state private consumption surface. ChatUI is not the answer.

---

## 2. Goals

The user can complete the full loop of **dispatch → wait → consume → follow up** on a single page at `/threads`, without depending on any external channel:

- Start a thread from one prominent entry point (`+ New thread`), write a structured brief, and know which agent it was dispatched to.
- See the recently loaded Web Threads bucketed into three states (Working /
  Completed / Archived), with failed tasks folded into Completed but instantly
  recognizable by a `✗`.
- On any thread, expand the agent's working process (Process) — **collapsed by default, expanded on demand** — to build trust.
- Post a comment on a non-terminal Completed Thread, or unarchive and continue
  an Archived Thread, when its lifecycle capability is available. A Buried
  Thread can appear in Completed but stays read-only.
- While the Threads page remains open, optionally receive a browser notification when a visible Thread moves from Working to Completed.

> **TL;DR** — One page (`/threads`) + three-state bucketing + single-field thread creation + Follow up = the full loop.

---

## 3. Concept definitions

| Term                     | Plain-language explanation                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Thread**               | The full lifecycle container for one task. 1 task = 1 thread; a new task starts a new thread. Its title is a natural-text projection of the first prompt paragraph, capped at 80 characters. Under the hood it is a product projection of AgentSession; it does not introduce a new API id space. |
| **State**                | A Thread's three UI buckets: `working` / `completed` / `archived`. `completed` also contains terminal Buried Sessions, so the bucket alone does not grant Follow up.                                                                                                                              |
| **Outcome**              | Exists only when state = `completed`: `success` or `failure`. `failure` is shown in the UI with a `✗` but still lives in the Completed bucket.                                                                                                                                                    |
| **User dispatch**        | The first message the user sends when starting a thread — the thread's brief.                                                                                                                                                                                                                     |
| **User comment**         | An additional message posted inside Thread detail when `send_user_message` or `unarchive_session` is available. Buried Threads display the lifecycle reason and disable sending.                                                                                                                  |
| **Agent reply**          | The agent's reply — at the product layer, both process-type events (thinking / tool calls / file changes) and final-type events are uniformly labeled `agent reply`, with details exposed through the Process modal.                                                                              |
| **Process**              | The event sequence behind a single agent reply (thinking / tool use / file changed / run.\*, etc.), expandable on demand to view the timeline.                                                                                                                                                    |
| **Follow up**            | Posting another message when the Session capability allows it. A non-terminal Completed Thread returns to working; an Archived Thread is unarchived first. A terminal Buried Thread has no return path and requires a new Thread.                                                                 |
| **statusLine**           | A one-line context text on the thread row — a productized summary of the most recent agent activity.                                                                                                                                                                                              |
| **Pin**                  | The user marks this thread to pin it to the top. Pin and unread state are local preferences stored in the current browser, not account-level cross-device state.                                                                                                                                  |
| **Locked-agent compose** | A variant of the New thread dialog: the agent is locked via a query param and the picker can't be changed. Used by the Agent **Publish → Distribution → Thread** and publish-success entry points.                                                                                                |

> **TL;DR** — A Thread is a task container; the three states + outcome describe its progress; Follow up means saying one more thing on an already-completed thread; Process is an on-demand process-transparency layer.

---

## 4. Information architecture (Before / After)

```mermaid
flowchart LR
  subgraph Before
    BNav[Nav: STUDIO only] --> BAgents[Agents]
    BAgents --> BChat[ChatUI: agent-first session]
    BChat -.- BMiss[× no task-first entry]
    BChat -.- BMiss2[× no three-state bucketing]
    BChat -.- BMiss3[× no task inbox]
  end
  subgraph After
    ANav[Nav: App Overview / Runs / Agents / Config] --> AThreads[/threads three buckets/]
    AThreads --> ADetail[/threads/:id activity stream/]
    ADetail --> AProcess[Process modal · on demand]
    AThreads --> ANotice[Page-open browser notification]
    BChat2[Preview ChatUI] -.demoted.-> APreview[pre-exposure debug only]
  end
  Before ==> After
```

The core changes:

- **Entry point** — from "pick an agent first" to "look at Threads first." The standard New thread action lives on `/threads`; the primary console CTA can remain App-building oriented.
- **Form factor** — from "IM metaphor" to "Inbox + ticket detail." The three-state buckets make working / completed / archived recognizable at a glance.
- **Notification** — while the page is mounted and permission is granted, a Working → Completed transition can create a browser notification that deep-links to the Thread. There is no Service Worker, push subscription, or closed-page delivery.
- **ChatUI doesn't disappear** — it is merely demoted from the "default consumption surface" to a "pre-exposure debug" tool, kept inside Studio Preview.

> **TL;DR** — Threads becomes an App-level consumption view; ChatUI is demoted to Studio Preview; the shipped form has Threads list / Thread detail / Process modal.

---

## 5. Global state machine

```mermaid
stateDiagram-v2
  [*] --> Working: user dispatch
  Working --> Completed_Success: agent finishes (success)
  Working --> Completed_Failure: agent finishes (failure)
  Working --> Buried: runtime terminates
  Completed_Success --> Archived: user archive
  Completed_Failure --> Archived: user archive
  Completed_Success --> Working: Follow up
  Completed_Failure --> Working: Follow up
  Archived --> Working: Follow up (auto unarchive)
  Working --> [*]: user delete
  Completed_Success --> [*]: user delete
  Completed_Failure --> [*]: user delete
  Archived --> [*]: user delete
  Buried --> [*]: user delete
```

A few rules worth spelling out:

- **The state machine is intentionally simple** — three stable states + one "say one more thing" return path. The user doesn't need to learn shared-board semantics like Open / In Review / Resolved.
- **Follow up is capability-gated** — a non-terminal Completed Thread can return
  to working, and an Archived Thread is unarchived first, only when the matching
  Session capability is available. Buried is terminal and read-only.
- **Failure is not its own bucket** — `failure` is folded into Completed and marked with a `✗`. A separate Failed bucket would give users the illusion that "this is a different kind of problem," when it's really just an outcome dimension.
- **Delete is a hard delete** — it goes through a `window.confirm` secondary confirmation and is irreversible.

> **TL;DR** — A three-state machine: `working` ↔ `completed` ↔ `archived`, where Follow up is the return path and failures are folded into the Completed bucket.

---

## 6. Chapter map (web UI form factor)

The shipped surface breaks into four UI chapters in outside-in order:

### 6.1 Chapter 1 · Threads list

The `/threads` page: a top-of-page count `N working · N completed · (N archived)
shown` + filter chips (All / Unread / Pinned / Failed) + three buckets. The
current Web client loads at most 100 recently updated non-archived Threads and
100 recently updated archived Threads and has no pagination control, so these
are displayed-record counts rather than all-time totals. Hovering a row reveals
`Pin · Archive · Delete` on its right side.

Personal-inbox-style affordances include Pin to top, an unread blue dot, and filter chips. Pin/unread state is stored in this browser. When the page is open and notification permission is granted, a newly observed completion can create a browser system notification; clicking it deep-links to `/threads/<id>`. This is not off-page push delivery.

> **TL;DR** — A Gmail-style Inbox, split into three sections, with browser-local unread / pin preferences and optional page-open completion notifications.

### 6.2 Chapter 2 · New thread compose

A single-field compose dialog: a body textarea + an Assign-to agent picker + attachments + a character count. **There is no separate title field**; the title is derived server-side from the first paragraph, preserves natural text, and is capped at 80 characters without going through an LLM.

Two entry points:

- The `New thread` button on the `/threads` page header / empty state — the standard variant, where you freely pick an agent. (Originally framed as a sidebar `+ New thread` primary CTA; the sidebar primary CTA was reassigned to `+ New agent`, but the compose dialog itself is unchanged.)
- A published Agent's Publish menu → Distribution → `Thread` action (or the
  publish-success `Try in Mosoo` action) — the locked-agent variant, where the
  Agent is already selected.

> **TL;DR** — A single-field brief + pick an agent + ⌘↵ to send. No title field, no AI polishing.

### 6.3 Chapter 3 · Thread detail

The `/threads/:threadId` page: breadcrumb + status pill + Archive button + the derived title + the user's original brief + the activity stream (collapsible CommentCards) + a minimal composer at the bottom. It does not render a separate slug.

The composer presentation follows the list bucket, but sending follows Session
capabilities:

- With `send_user_message` available, `↑` posts a comment; on a non-terminal
  Completed Thread, `↻` starts another Run.
- With `unarchive_session` available, an Archived Thread uses `↻`, unarchives,
  then sends the message.
- When the required capability is unavailable, including Buried, the composer
  shows the read-only reason and disables send.

When you enter the detail page, any new activity is automatically marked as read, and the unread blue dot disappears once you return to the list.

> **TL;DR** — Like a GitHub Issue detail page: read the brief, view the activity stream, and "say one more thing" at the bottom.

### 6.4 Chapter 4 · Process modal

Below each agent reply there is a "Show process · N events" button; clicking it opens a centered modal:

- Top stats (duration / event count / tokens)
- A horizontal timeline bar (one segment per event, width proportional to duration)
- An event list, where clicking expands the persisted event `content` projection

It's used to answer "what exactly did the agent do this round, and how long did it take?" **Collapsed by default, expanded on demand** — it is not the mainstream of consumption.

> **TL;DR** — An on-demand "process-transparency layer," used to build the user's trust in the agent, not the default consumption form.

---
