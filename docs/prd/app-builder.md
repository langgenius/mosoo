# App Builder

App Builder makes App the first-class creation surface in Mosoo. In this PRD,
App means Agent App: the user-facing product unit that a builder creates,
opens, tests, publishes, and distributes.

An App can contain one or more Agents. Each Agent is a peer business-level
engine for part of the App, not a hidden implementation helper behind a generic
app surface. App Builder must not predefine a core Agent, primary Agent, or
system-owned hierarchy between Agents. If an App has a lead/supporting-Agent
relationship, that is a user-designed usage pattern, not a platform assumption.

## Product Positioning

Mosoo should shift the creation experience from Agent-first to App-first. Users
should not begin by choosing internal Agent categories, runtime mechanics, or
tooling taxonomies. They should begin with a rough product goal: "what kind of
App do I want to create?"

The App abstraction sits above Agents. It does not move Agent-owned runtime
boundaries elsewhere.

```text
App
└── Agents
    └── Agent
        ├── Threads
        ├── Runtime resources
        │   ├── Model / Provider
        │   ├── Prompt
        │   ├── Environment
        │   ├── Skills
        │   └── MCP servers
        ├── Preview / Logs / Cost
        └── Publish / API access / Channels
```

Thread belongs under Agent. Runtime resources belong under Agent. App is the
product-level abstraction above Agents, not a Thread, not a runtime container,
and not a traditional page builder.

## Current State

The current product surface is still mostly Agent-first. The web app exposes
Agents directly, and the existing Agent Builder helps users create or modify an
Agent draft. This is the implementation base for App Builder, but it is not the
final product framing.

Code evidence: `apps/web/src/app/navigation.tsx`, `apps/web/src/app/route-registry.tsx`, `apps/web/src/routes/agent/components/create-agent-launcher.tsx`, `apps/web/src/routes/agent/lifecycle/lifecycle-shell.tsx`, `apps/web/src/routes/agent/components/agent-builder/agent-builder-panel.tsx`, `apps/api/src/modules/agent-builder/**`, `pkgs/contracts/src/agent-builder/**`.

A pure frontend App Builder prototype exists at
`apps/web/src/routes/app-builder-mock/app-builder-mock.route.tsx`. It is a mock
implementation of the desired App-first creation surface and publish
instruction flow. The prototype is evidence for interaction shape, not backend
contract completeness.

The current prototype also expresses the new multiple-Agent builder shape: one
App draft owns multiple Agent drafts, and the right-side form area uses
browser-like Agent tabs to switch between independently editable Agent forms.

## Decision Summary

The latest product decisions are:

- App means Agent App. It is the user-facing product unit.
- App Builder supports one App draft with multiple Agent drafts.
- Each Agent is a peer business-level engine owned by the App.
- App Builder must not predefine a core Agent, primary Agent, or Agent
  hierarchy. Users may decide how Agents relate to each other in their own App
  design.
- Thread is under Agent.
- Runtime resources are under Agent.
- App Builder must preserve the full configuration form and help the user fill
  it, instead of replacing the form with chat.
- The right configuration area uses browser-like Agent tabs. Each tab represents
  one Agent draft and owns one independent editable Agent form.
- App-level identity, such as App name and status, belongs in the workspace
  header above the Agent tabs. It should not be repeated inside every Agent
  tab.
- Each Agent tab title is the editable Agent name and must stay synchronized
  with the Agent name field inside that tab's form.
- The left Builder composer remains global to the App draft. It stays visible
  while the user switches Agent tabs and can propose visible edits for any Agent
  form.
- Publish is an App-level lifecycle action in the page header, not a bottom
  section inside an Agent form.
- The first creation screen should offer Agent App templates. Each template can
  carry a default run-mode recommendation behind the scenes.
- The primary creation flow should not make the user choose internal categories
  such as Assistant Agent or Task Agent.
- If behavior is exposed in an Agent form, the label should be `How it runs` and
  describe that Agent's behavior as users experience it.
- The progress model is `Agent → Files → Environment → Test`.
- `Test` is the final creation node and represents Thread reachability for the
  App's configured Agent or Agents.
- Publish starts the App's configured Agent or Agents in the online Cloudflare
  runtime and makes the App accessible according to its access settings.
- Publishing also generates `instruction.md`, a platform-neutral development
  instruction file for external Coding Agents.
- `instruction.md` is not a Skill, not a runtime artifact, and not consumed by
  the Agent App's own Agent.
- Publish should show preparation feedback before opening the instruction modal.
- After publish, the Publish button should become a `Published` dropdown entry
  with `instruction.md` and `Unpublish` actions.

## Product Principles

1. Start from the App goal, not from Agent taxonomy.
2. Keep Agents explicit because they are the App's business engines.
3. Keep the complete configuration form visible and editable.
4. Treat App Builder as assistance for the form, not a replacement for it.
5. Make AI-generated changes reviewable through visible form values.
6. Support multiple Agents without hiding their individual forms.
7. Keep Thread and runtime resource ownership under Agent.
8. Generate development instruction context at publish time instead of maintaining a
   live PRD document during creation.

## Target Flow

When the user opens App and there are no Apps, Mosoo should show a direct
creation prompt instead of an empty table or setup checklist.

```text
Open App
→ Empty state asks what App to create and offers Agent App templates
→ User submits a rough requirement
→ Create App draft
→ Enter App creation page
→ Show the full tabbed Agent configuration area
→ App Builder translates user intent into visible form values
→ User reviews or edits App-level header fields and Agent tab forms
→ User tests in Chat through a Thread
→ User publishes
→ Mosoo starts the App's configured Agent or Agents in the online Cloudflare runtime
→ Mosoo prepares instruction.md
→ Mosoo shows the App published modal
→ Publish entry becomes Published
```

The initial prompt should ask a simple question such as "What kind of App do
you want to create?" The user can enter an incomplete or fuzzy requirement.
Pressing Enter creates a draft and opens the App creation page.

The same screen should also offer a small set of Agent App templates, such as
Support assistant, Sales follow-up, Report generator, Image gallery, Data
monitor, and Workflow automation. Templates are not just copy shortcuts: each
template may set a default Agent behavior, tools, Files, prompt pattern, and
environment expectation behind the scenes.

## App Creation Page

The App creation page must show the full configuration form. App Builder does
not hide the form or replace it with a black-box chat flow. The form remains the
source of truth for runnable configuration.

App Builder is an AI assistance layer attached to the form. It helps the user
fill, revise, and understand the form by translating natural-language
requirements into visible field changes.

App Builder should help with:

- App-level naming and lifecycle intent.
- Creating, naming, and editing multiple Agents under the App.
- Each Agent's role and behavior.
- Prompt content for each Agent.
- Model and provider suggestions.
- Environment selection or creation guidance.
- Skill, MCP server, and Files suggestions.
- Thread test feedback that should change configuration.

The first-level creation page should include:

- A Builder conversation area for rough requirements, clarifications, and change
  requests. This composer is global to the App draft, not scoped to one hidden
  Agent tab.
- A top App header with editable App name, App status, Test, and Publish
  actions.
- A right-side Agent tab area grouped by independently editable Agent drafts:
  - Browser-like Agent tabs across the top of the form area.
  - One tab per Agent draft.
  - Tab title equals the editable Agent name in that Agent form.
  - Each tab contains Agent name, Agent description, `How it runs`,
    model/provider, system prompt, Skills, MCP servers, and Environment
    fields.
  - Switching tabs changes only the visible Agent form. It must not overwrite,
    duplicate, or reset other Agents' values.
- A Test in Chat entry point that creates or opens a Thread for validation.
- A Publish button that starts the online publish flow and opens the App
  published modal.
- A Published dropdown after successful publish.

The right form area should not repeat an App identity block inside every Agent
tab. App-level identity belongs to the top header. Agent-level identity belongs
inside each Agent form.

## Multiple-Agent Visibility And Editability

The App Builder creation workspace supports one App draft with multiple Agent
drafts. The left Builder composer remains a single global composer for the App
draft. It stays visible while the user switches Agent tabs, so Builder context is
not scoped to a hidden per-Agent chat.

The right configuration area uses browser-like Agent tabs. Each tab represents
one Agent draft and owns an independent editable Agent form. Switching tabs
changes only the active Agent form; it must not overwrite or duplicate other
Agents' form values.

Each Agent tab title is the Agent name. Editing the Agent name in the form
immediately updates the tab title. App-level identity such as App name belongs
to the workspace header and is not repeated inside Agent tabs.

Builder-generated changes must be reviewable as visible field values. When
Builder edits an Agent, the affected Agent tab should become active or otherwise
clearly identify the target Agent. Users can switch tabs to inspect and manually
edit every Agent form.

## Internal Agent Type Handling

The App creation page should not force users to choose between visible internal
categories such as "Assistant Agent" and "Task Agent."

That choice adds cognitive cost before the user has expressed the App they want.
It also narrows the user's imagination by implying Mosoo can only create Apps
that fit those two categories.

Product behavior:

- Users describe the App goal in product language.
- Agent App templates may set a default run-mode recommendation based on the
  business pattern.
- App Builder owns a mutable recommended run-mode field and may update it from
  user requirements or later conversation.
- If an internal Agent type remains necessary, it should be inferred, defaulted,
  or moved to an advanced runtime setting.
- The primary App creation path should not start with or center on this
  taxonomy.

If an Agent form exposes behavior, it should use `How it runs`. The visible
choices should describe user-facing Agent behavior, such as `Ongoing` for
Agents that continue work across sessions and `One-off` for Agents that handle
each session as a separate task. `Recommended` is a Builder-controlled form
value, not a hard-coded frontend label. The internal mapping to Assistant-like
or Task-like runtime behavior remains implementation detail.

App Builder should show proposed changes as visible patches or clearly reflected
form updates. Users must be able to review, edit, or reject generated
configuration.

## Progress Model

The App creation page should use progress that matches the real creation path:

```text
Agent → Files → Environment → Test
```

Progress definitions:

- Agent: the App's Agent drafts have enough identity, model, prompt, and
  behavior configuration to run as App business engines. For a multiple-Agent
  App, each Agent tab should make its own readiness visible.
- Files: the App has the required knowledge or business-context files available
  to its Agents.
- Environment: the runtime environment is selected or prepared, and required
  runtime resources are reachable.
- Test: Test in Chat has verified that the App can be reached through a Thread
  and the selected Agent or App test target can respond in that environment.

`Test` is the final progress node. Publishing should be allowed only when the
product decides the current test requirements are satisfied, or it should make
the missing test state explicit.

## Source Of Truth

MVP should not maintain a separate live PRD document during every Builder turn.
This avoids a complex synchronization problem between PRD text, form values, and
manual edits.

The MVP source-of-truth model is:

- The App header is the source of truth for App-level identity and lifecycle
  state shown in the creation workspace.
- Each Agent tab form is the runnable configuration source of truth for that
  Agent.
- Agent tab titles are derived from the editable Agent name field.
- App Builder conversation history is global App requirement context.
- Thread test feedback is requirement context.
- Publish-time export can summarize the context into a platform-neutral
  development instruction artifact.

Mosoo should not build PRD/form bidirectional sync in the MVP. It should not
introduce "PRD changed, config pending" or "config changed, PRD pending" states
until the product proves that live PRD editing is necessary.

## App Manifest YAML Contract

Current code has two Agent YAML-adjacent shapes:

- The existing export/import path is a single-Agent contract. `AgentManifest`
  lives in `pkgs/contracts/src/agent/agent-manifest.contract.ts` and is
  serialized by `serializeAgentManifestToYaml`. Its stable sections are
  `manifestVersion`, `kind`, `metadata`, `runtime`, `prompts`, `skills`,
  `mcpServers`, `environment`, and `advanced`.
- The current Agent editor draft YAML lives in
  `apps/web/src/routes/agent/components/editor/draft.ts`. It is a form-editing
  shape with `version: 1`, `identity`, `kind`, `runtime`, `prompt`,
  `environment`, `assets`, and optional `builder` metadata.

Neither shape is a multiple-Agent App YAML. App Builder should introduce an
App-level manifest that reuses the Agent configuration sections from the current
Agent manifest, but wraps them in a single App document.

The canonical App Builder YAML is one App-level manifest:

```yaml
manifestVersion: "mosoo.app.manifest.v1"
app:
  name: "Sales Follow-up App"
  description: "Qualifies inbound leads and prepares follow-up drafts."

agents:
  - key: "qualifier"
    metadata:
      name: "Qualifier"
      description: "Scores and summarizes inbound sales conversations."
    behavior:
      mode: "ongoing"
    runtime:
      id: "openai-runtime"
      provider: "openai"
      model: "gpt-4.1"
      providerOptions: {}
    prompts:
      system: |
        Qualify inbound sales conversations and summarize next steps.
    skills: []
    mcpServers: []
    environment:
      environmentId: null
      expectedName: "Default"
      setupScript: ""
      envVars: {}
    advanced:
      unparsedFields: {}
    extensions: {}

  - key: "follow_up_writer"
    metadata:
      name: "Follow-up Writer"
      description: "Drafts owner-reviewable customer follow-ups."
    behavior:
      mode: "one_off"
    runtime:
      id: "openai-runtime"
      provider: "openai"
      model: "gpt-4.1"
      providerOptions: {}
    prompts:
      system: |
        Draft concise follow-up messages for owner review.
    skills: []
    mcpServers: []
    environment:
      environmentId: null
      expectedName: "Default"
      setupScript: ""
      envVars: {}
    advanced:
      unparsedFields: {}
    extensions: {}

relations:
  - from: "qualifier"
    to: "follow_up_writer"
    type: "handoff"
    description: "Qualifier context can be handed to the follow-up writer."
    extensions: {}

extensions: {}
```

YAML rules:

- The App manifest is the canonical YAML for App Builder, publish, import, and
  export. It contains one `agents` list. It is not one YAML file per Agent.
- Split files may be supported only as a developer convenience, such as
  `app.yaml` plus `agents/<key>.yaml`. Import or publish must compile split
  files into the same single App manifest before validation.
- Every `agents[]` item must follow the same `AgentSpec` structure. Empty
  sections should be represented as `[]`, `{}`, or `null` instead of omitted
  ad hoc replacements.
- `agents[].key` is a local stable manifest key used for tab identity,
  relations, and imports. It is not the display name and should not be treated
  as a source App's platform ULID.
- `agents[].metadata.name` is the Agent name and drives the Agent tab title.
- `agents[].behavior.mode` is the product-facing `How it runs` value. It may be
  `ongoing` or `one_off`. Implementation may map this to the existing internal
  Agent `kind`, but the App YAML must not expose a core/primary Agent or Agent
  hierarchy.
- `runtime`, `prompts`, `skills`, `mcpServers`, and `environment`
  intentionally mirror the current single-Agent manifest sections so
  implementation can reuse existing parser, serializer, readiness, import, and
  repair concepts.
- `relations` is optional and user-defined. It can describe handoff,
  orchestration, routing, or other cooperation patterns, but it never creates a
  platform-imposed hierarchy.
- Unknown root fields are invalid. Extension data must live under explicit
  `extensions` objects.
- Extension keys must be namespaced, such as `x-mosoo`, `x-provider-openai`, or
  `x-team-acme`. Non-namespaced arbitrary fields are not allowed.
- `advanced.unparsedFields` is reserved for compatibility with existing
  AgentManifest concepts. New App Builder extension data should use
  `extensions`, not `advanced.unparsedFields`.
- Secrets, plaintext provider keys, OAuth tokens, webhook signing secrets, and
  personal credentials must not appear in the YAML.

## Publish Lifecycle And Development Instruction

When the user publishes an App, Mosoo starts the App's configured Agent or
Agents in the online Cloudflare runtime. The App enters a published,
online-accessible lifecycle state according to its access settings.

Publishing also generates an `instruction.md` file for external Coding Agent
workflows. This file is generated at publish time, not maintained during every
Builder turn.

The generated file is a development instruction file. It is not a Skill, not a
runtime tool, and not something mounted back into the Agent App. It is portable
context and instructions for external Coding Agents.

The file must be generated by App Builder because App Builder owns the creation
conversation, form edits, inferred intent, and Thread test feedback. Users
should not need to restate the App goal in another coding tool.

The publish flow should be a publish lifecycle experience with an instruction
modal after the App is online. It may show a short "Publishing App..." state
while Mosoo:

- Starts the App's configured Agent or Agents in the online Cloudflare runtime.
- Applies publish and access state.
- Collects the initial App creation request.
- Summarizes App Builder conversation history.
- Includes App ID and Agent IDs.
- Produces a concise PRD summarized from Builder context.
- Includes relevant Thread test feedback.
- Captures publish and distribution intent.

The generated `instruction.md` should help an external Coding Agent
understand:

- What Agent App the user is building.
- The App ID and Agent IDs needed for Mosoo CLI and OpenAPI calls.
- Who the App is for.
- What problem it solves.
- What each Agent should do.
- What user preferences or boundaries were discussed.
- What should not be changed or assumed.
- What implementation context matters next.

The instruction should not embed a full App configuration snapshot. App
configuration is expected to be fetched on demand by App ID through Mosoo CLI or
OpenAPI. This keeps the instruction short and avoids stale configuration data.

## Instruction Generation Rules

App Builder should generate `instruction.md` with this process:

1. Collect the current App ID and Agent IDs.
2. Collect Builder conversation history, initial user requirement, accepted form
   edits, and Thread test feedback.
3. Summarize a concise PRD from that context.
4. Add setup instructions for Node/npm, Mosoo CLI, Mosoo auth, Cloudflare
   Wrangler, and Cloudflare auth.
5. Add API Reference links and Mosoo CLI inspection commands.
6. Add Mosoo CLI skill pull instructions so the external Coding Agent can load
   CLI usage guidance.
7. Add harness and guardrail instructions that tell the Coding Agent what Mosoo
   already owns.
8. Render the result as a structured Markdown file.

Generation constraints:

- Do not include secrets, access tokens, private API keys, or user credentials.
- Do not include a full App configuration snapshot.
- Do not ask the Coding Agent to rebuild Agent runtime, Sandbox, Thread
  runtime, model orchestration, Environment infrastructure, or Mosoo-owned Agent
  behavior.
- Do not expose internal App Builder implementation details.
- Do not refer to one specific external Coding Agent platform.
- Prefer direct commands in fenced `bash` blocks.
- Prefer short, imperative instructions over long explanation.
- Keep the instruction focused enough to fit comfortably in an external Coding
  Agent context window.

## Instruction Template

The generated `instruction.md` should follow this structure:

```text
# App Development Instruction

Purpose statement

## 1. Environment Setup
- Check Node/npm
- Install/authenticate Wrangler
- Install/authenticate Mosoo CLI
- Pull Mosoo CLI usage instructions
- Link API Reference

## 2. Mosoo Identifiers
- App ID
- Agent IDs
- CLI commands to inspect App and Agents
- Instruction to pull configuration by App ID when needed

## 3. App Summary
- Name
- Goal
- Audience
- Account model or access assumptions
- Agent ownership statement

## 4. Short PRD
- Problem
- User Experience
- Functional Requirements
- Non-Goals

## 5. Existing Mosoo-Owned Capabilities
- App Agents
- Runtime execution
- Sandbox / Environment
- Thread reachability
- Model/provider orchestration
- Publishing and API access

## 6. Implementation Guidance
- What to inspect first
- What code areas to build
- What APIs or CLI commands to prefer

## 7. Harness And Guardrails
- What not to reimplement
- What to fetch through Mosoo
- How to handle gaps

## 8. Cloudflare Requirements
- Wrangler auth checks
- Existing Worker/scaffold checks

## 9. Suggested First Tasks
- Ordered task list for the Coding Agent

## 10. App-Specific Data Shape
- Only if useful
- Must be local unless it matches Mosoo API Reference

## 11. Done Criteria
- Reviewable completion checklist
```

Flow:

```text
User clicks Publish
→ Mosoo shows a short preparing state
→ Mosoo starts the App's configured Agent or Agents in the online Cloudflare runtime
→ Mosoo makes the App online-accessible according to access settings
→ Mosoo summarizes Builder conversation + App ID + Agent IDs + Thread test feedback
→ Mosoo renders platform-neutral instruction.md
→ Mosoo opens the App published modal
→ User can review and edit instruction.md
→ User can copy or download the current edited instruction.md
→ User can open API Reference from a secondary link
→ User closes the modal
→ Publish button becomes Published
→ User can reopen instruction.md or Unpublish from the Published dropdown
```

Modal requirements:

- Title should confirm publish success, for example "App published."
- The title and body should not mention specific Coding Agent products.
- Show the full `instruction.md` content inside a small bordered scroll
  area. The whole modal should not become a long document reader.
- The `instruction.md` preview must be editable before copy or download.
- Copy and Download must use the user's current edited content.
- Editing the preview should reset any copied success state.
- Provide a Copy action.
- Provide a Download action.
- The downloaded filename should be `instruction.md`.
- Include App ID and Agent IDs in the generated file.
- Tell the Coding Agent to fetch current App configuration by App ID when it
  needs configuration details.
- Explain that the user can give these instructions to an external Coding Agent
  together with the Mosoo CLI and API Reference to continue App development.
- Show the API Reference link in a secondary location, such as the lower-left
  area of the modal.
- Do not add a primary Test in Thread button inside the instruction modal.
  Thread validation belongs to the App creation header or the main test flow,
  not to the instruction file actions.

Preparing state requirements:

- Clicking Publish should not open the final modal instantly.
- Show a small floating preparing surface for roughly two seconds in the mock.
- The preparing surface should communicate that Mosoo is publishing the App by
  starting the configured Agent or Agents online and preparing `instruction.md`.
- The Publish button should show a publishing label and spinner during this
  wait.

Post-publish state requirements:

- After the configured Agent or Agents are online and the instruction modal is
  generated, the main publish entry should become `Published`.
- `Published` should be a dropdown trigger, not a second primary publish action.
- The dropdown should include `instruction.md`, which reopens the same
  instruction modal.
- The dropdown should include `Unpublish`, which returns the App to an
  unpublished state.
- If the user changes App configuration or Builder content after publishing, the
  App should return to an unpublished draft state because the previous
  instruction may no longer match the current form.

Product rule: `instruction.md` is a development instruction artifact for
external Coding Agents, not an Agent App runtime artifact and not a Skill.
Publish is the App lifecycle action. Instruction generation is a companion
artifact of publishing, not the definition of publishing.

## Thread Testing

Testing should guide the user toward Thread reachability because Thread belongs
under Agent and is the interaction surface that proves the App can be used.

MVP can mock this destination if the final Thread page is not ready. The mock
should still communicate the intended contract:

- Test in Chat creates or opens a Thread for the selected Agent or the App's
  configured test target.
- The Thread can reach the selected Environment.
- The Agent can respond using the current form configuration.
- Test feedback can be sent back to App Builder and reflected in the form.

## Prototype And Screenshot Policy

The PRD should not embed a screenshot for every UI point. That would make the
PRD expensive to maintain and would turn the document into a brittle visual QA
artifact.

Use screenshots only as lightweight evidence for stable, high-risk interaction
states. The canonical source for exact pixels is the frontend prototype and the
design implementation, not this Markdown PRD.

When screenshots are needed for review, capture only these states:

1. App creation page with Builder chat, Agent tabs, full form, and progress
   `Agent → Files → Environment → Test`.
2. Publish preparing popover after clicking Publish.
3. App published modal with editable `instruction.md`, Copy, Download, and
   secondary API Reference link.
4. Published dropdown showing `instruction.md` and `Unpublish`.

Do not require screenshots for every field, dropdown item, hover state, or copy
variant unless a design review specifically asks for visual evidence.

## MVP Requirements

1. Add an App-first entry point and empty-state creation prompt.
2. Create an App draft from a rough user requirement.
3. Open a first-level App creation page after submission.
4. Keep the complete configuration form visible and editable.
5. Support multiple Agent drafts under one App draft.
6. Represent Agent drafts as right-side Agent tabs, with one independent
   editable Agent form per tab.
7. Keep the left Builder composer visible while switching Agent tabs, and let it
   propose visible edits for any Agent form.
8. Keep App-level identity in the page header, not inside each Agent tab.
9. Attach App Builder to the form as an AI assistant that converts user intent
   into form changes.
10. Define the App Builder YAML contract as one App-level manifest containing a
    same-structure `agents[]` list.
11. Keep YAML extension data inside namespaced `extensions` objects.
12. Do not require users to choose visible internal Agent categories during the
    primary creation flow.
13. Use `Agent → Files → Environment → Test` as the creation progress model.
14. Preserve Builder conversation context for later summarization.
15. Let Thread test feedback continue through App Builder and form edits.
16. Start the App's configured Agent or Agents in the online Cloudflare runtime
    during publish.
17. Generate a concise development instruction file as a companion artifact of
    publishing.
18. Expose the generated `instruction.md` through the App published modal with
    copy and download actions.
19. Include App ID, Agent IDs, API Reference access, and Thread testing guidance
    in the publish instruction.
20. Make the instruction preview editable and use edited content for copy and
    download.
21. Show a publishing state before the App published modal opens.
22. Turn Publish into a `Published` dropdown after successful publish.
23. Let the user reopen `instruction.md` or Unpublish from the `Published`
    dropdown.

## Non-Goals

- Do not build a traditional no-code page builder.
- Do not treat App as Thread.
- Do not move Threads out from under Agent.
- Do not move runtime resources out from under Agent.
- Do not hide the configuration form behind a chat-only experience.
- Do not force users to choose internal Agent type taxonomy in the primary App
  creation flow.
- Do not collapse multiple Agent drafts into one hidden or shared form.
- Do not scope the Builder composer to only the currently visible Agent tab.
- Do not make one canonical YAML file per Agent for App Builder.
- Do not allow each Agent to invent its own YAML shape.
- Do not accept arbitrary non-namespaced fields as extension data.
- Do not silently overwrite user-edited fields.
- Do not maintain a live PRD document during MVP creation.
- Do not build PRD/form bidirectional synchronization in MVP.
- Do not describe the generated instruction file as a Skill.
- Do not embed a full App configuration snapshot in the generated instruction file.
- Do not make the generated instructions sound specific to one external Coding
  Agent platform.
- Do not use the PRD as an exhaustive screenshot archive.
- Do not place a primary Thread testing CTA inside the instruction modal.

## Acceptance Criteria

- A new user can start from App, type a rough requirement, and land in an App creation page.
- The App creation page clearly shows both the full form and App Builder assistance.
- The App creation page can represent multiple Agents under one App draft.
- The right configuration area shows Agent tabs, with each tab owning an
  independent editable Agent form.
- Switching Agent tabs preserves each Agent's form values.
- Editing an Agent name updates that Agent's tab title.
- The App name is editable from the header and is not repeated inside every
  Agent tab.
- The Builder composer remains visible while switching Agent tabs and can target
  any Agent form through visible changes.
- The App Builder YAML is one App-level manifest with a same-structure
  `agents[]` list.
- Every Agent entry uses the same `AgentSpec` sections, even when some sections
  are empty.
- Extension data is accepted only through explicit namespaced `extensions`
  objects.
- The user does not need to understand or choose internal Agent type taxonomy to
  create the App.
- App Builder can convert user requests into visible configuration changes.
- Manual form edits remain possible at every point.
- Progress is shown as `Agent → Files → Environment → Test`.
- Test in Chat can validate Thread reachability for the selected Agent or
  configured App test target, even if the first implementation uses a mock
  Thread destination.
- Publishing starts the App's configured Agent or Agents in the online
  Cloudflare runtime.
- Publishing opens an App published modal.
- Publishing prepares `instruction.md` as a companion artifact from conversation
  history, App ID, Agent IDs, concise PRD content, and Thread test feedback.
- Publishing shows a short publishing state before the App published modal
  appears.
- The generated instruction instructs the Coding Agent to fetch current App
  configuration by App ID instead of relying on an embedded configuration
  snapshot.
- The generated file is available to the user and is clearly labeled as an
  external Coding Agent development instruction artifact.
- The publish modal provides both Copy and Download actions.
- The publish modal lets the user edit `instruction.md` before copying or
  downloading.
- The publish modal includes a secondary API Reference link.
- Closing the publish modal leaves the App in `Published` state.
- The `Published` dropdown can reopen `instruction.md`.
- The `Published` dropdown can Unpublish the App.
- Editing App configuration after publishing returns the App to an unpublished
  draft state.
