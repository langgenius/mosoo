# GoGym Reflection: Mosoo Is an Agent Backend, Not Just a Runtime

Building GoGym was valuable because it forced us to define what Mosoo actually sells, rather than merely describe how Mosoo is implemented.

Our earlier framing often stopped at one of these descriptions:

> Mosoo is hosted Claude Code.
>
> Mosoo is a managed Agent.
>
> Mosoo is an Agent runtime.

GoGym suggests a more durable product boundary. A normal application should be able to embed an Agent as one capability without rebuilding identity propagation, execution lifecycle, tool integration, or frontend event handling for every project.

```text
                Application Developer
                         │
             ┌───────────┴────────────┐
             │                        │
        GoGym / CRM / IDE / ERP / ...
             │
             │ Thread / Run API
             ▼
            Mosoo
             │
   ┌─────────┼───────────────┬──────────────────┐
   │         │               │                  │
Delegation  Harness-neutral  Agent Execution   Event Stream
   │         MCP             Thread / Run       Normalization
   └─────────┴───────────────┴──────────────────┘
                         │
                         ▼
                    Business MCP
                         │
                 Supabase / Stripe /
                  GitHub / Slack / ...
```

The four capabilities below are not implementation details. Together, they define the product Mosoo can become.

## 1. App User Delegation

App User Delegation may be the most defensible part of the product.

Imagine that Alice opens GoGym and asks the Agent to record a meal. The Agent appears to call:

```text
record_meal()
```

The real execution context is closer to:

```text
record_meal(
  acting_for = "alice",
  thread = "thread-123",
  app = "gogym"
)
```

The model must not choose or invent `alice`. It should never need access to the user table or the database credential. It only needs a trustworthy statement:

> This Agent is currently acting on behalf of Alice in GoGym.

Mosoo's responsibility is to carry and prove that statement across the Agent execution boundary.

This is not a replacement for application authentication or business authorization. The application still authenticates Alice, and the business service still decides what Alice may do. Delegation is the secure on-behalf-of link between them:

```text
Application authentication
        ↓
Trusted app user identity
        ↓
Mosoo Thread
        ↓
Short-lived delegated identity
        ↓
Business MCP authorization
```

The clean application-facing contract is intentionally small:

```http
POST /threads
Content-Type: application/json

{
  "userId": "alice"
}
```

The `userId` is supplied only by a trusted application backend, becomes immutable for that Thread, and is inherited by every Run and MCP call inside the Thread. The Agent cannot override it through a prompt or tool argument.

This matters anywhere an Agent acts inside a multi-user application: CRM, GitHub automation, Slack operations, Linear workflows, finance software, internal tools, or customer-facing SaaS. The recurring question is always the same:

> On whose behalf is this Agent acting?

Mosoo should make that question easy to answer safely.

## 2. An Application-Oriented Thread and Run API

Many runtime interfaces expose lifecycle primitives such as:

```text
session.start()
session.send()
session.stop()
```

Those primitives are understandable to an Agent-runtime developer. They are not the natural vocabulary of an application developer.

An application developer thinks in durable product entities:

```http
POST /threads
POST /threads/:threadId/messages
POST /threads/:threadId/runs
GET  /runs/:runId
GET  /threads/:threadId/artifacts
```

The important nouns are:

- **Thread**: the application's durable conversation boundary;
- **Run**: one execution attempt with an observable lifecycle;
- **Message or Event**: input and output attached to the Thread;
- **Artifact**: a durable result that the application can present or reuse.

These are Product API nouns. `Container`, `TTY`, `terminal`, and process lifecycle are Infra API nouns.

Mosoo may use containers, sandboxes, drivers, or terminals internally, but an application should not have to model those resources. The public contract should remain stable even when the underlying Harness or execution infrastructure changes.

## 3. Harness-Neutral MCP

Business tools should not be coupled to one model vendor or one Harness.

Today, a tool might be introduced as a Claude MCP integration. The long-term shape is broader:

```text
Claude Code
Codex
OpenCode
GPT-based runtimes
Gemini-based runtimes
Qwen- or Kimi-based runtimes
        │
        ▼
Mosoo Harness Adapter
        │
        ▼
Business MCP
        │
        ├── record_meal()
        ├── search_food()
        └── update_plan()
```

The business tools should remain unchanged when the application switches Harnesses. Mosoo absorbs the differences in tool discovery, invocation, lifecycle, and runtime event formats.

Harness-neutral does not mean that every Harness has identical capabilities. It means Mosoo exposes one product contract, declares capability gaps explicitly, and keeps vendor-specific adaptation behind that boundary.

This is especially valuable for application developers. They should be able to change the reasoning engine without rewriting the CRM, billing, fitness, or project-management integrations that make their application useful.

## 4. A Web-App-Oriented Event Stream

Web applications should not need to understand every low-level model event.

An Agent runtime may produce thousands of token deltas, several reasoning turns, and many tool lifecycle events. A product interface usually wants a much smaller set of stable states:

```text
Thinking...
Searching...
Recording meal...
Meal recorded ✓
Generating plan...
Done
```

The platform therefore needs a layered event model:

```text
Vendor-specific runtime events
              ↓
Normalized Mosoo events
              ↓
Application-defined business events
```

Mosoo should normalize Harness-specific differences into stable events such as:

- Run started, completed, failed, or cancelled;
- text output appended;
- tool call started, completed, or failed;
- artifact created or updated;
- user action or approval required.

Mosoo should not guess that a generic tool completion means `meal_recorded` or `invoice_paid`. Those meanings belong to the application. Business MCP tools or application code should be able to emit typed business events, while Mosoo transports them through the same ordered stream.

This division keeps React clients simple without moving business logic into the runtime platform.

## The Combined Positioning: Agent Backend

Taken together, these capabilities make Mosoo more than a runtime. They make it an **Agent Backend** for applications.

A traditional application backend commonly provides:

- authentication;
- database access;
- file storage;
- queues and background jobs.

Mosoo provides a complementary Agent backend layer:

- **Agent Identity** through App User Delegation;
- **Agent Execution** through Thread and Run APIs;
- **Agent Integration** through Harness-neutral MCP;
- **Agent UX Infrastructure** through normalized application event streams.

The positioning can be stated in one sentence:

> **Mosoo is the backend that lets applications safely embed AI agents.**

The important word is **applications**. Mosoo is not asking users to move their entire product into an Agent console. It lets a normal Web App invoke an Agent as naturally as it invokes a database, a payment service, or a background job, while Mosoo encapsulates execution, identity delegation, Harness adaptation, and runtime events.

## What Mosoo Should Not Own

The GoGym architecture also clarifies the negative boundary.

Mosoo should not become the source of truth for:

- application user accounts;
- business permissions;
- domain data;
- application UI;
- application-specific business tools;
- general-purpose Web deployment.

In GoGym, Supabase owns application identity and persistent business data. Cloudflare runs the Web application and MCP boundary. GoGym owns the fitness experience and domain rules. Mosoo owns Agent execution and the secure bridge into those capabilities.

This separation is a feature, not a weakness. Cloudflare, Supabase, or the model provider may be replaced without changing the product-level reason Mosoo exists.

## Product Implications

This reflection suggests a focused product sequence:

1. Make `userId` a clear, immutable Thread-level contract and delegate it safely to MCP.
2. Stabilize application-oriented Thread, Run, Message/Event, File, and Artifact semantics.
3. Verify the same MCP tools across every supported Harness and expose capability gaps honestly.
4. Provide a small, stable event vocabulary for Web applications, plus an extension path for application-defined business events.
5. Publish examples that begin with a real multi-user application, not an isolated Agent playground.

The GoGym lesson is ultimately simple: hosting an Agent is not enough. The durable value is making an Agent behave like a safe, composable backend capability inside a real product.
