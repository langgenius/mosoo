# Runtime Choice

Status: current core runtime surface under the canonical [mosoo Spec](../SPEC.md).

## Value

mosoo lets a Builder run an Agent Workload without learning how each model provider starts or operates it. Runtime choice exists to make supported workloads launch reliably; it is not a marketplace.

## Users and problem

The Project Owner configures runtime access while creating and editing an Agent. They need to know which choices can run with the provider keys saved in the active Project. Without clear availability, setup can end with a model that cannot launch. Project Users should never need to know which runtime or provider powers the experience.

## Current flow

1. The Project Owner adds a provider key in the active Project, or adds a custom endpoint with its model IDs and API protocol.
2. New Agent shows the available runtime choices and suggests a default based on configured keys.
3. In the Agent editor, the model picker offers models supported by the chosen runtime and unlocked by configured keys. A missing key sends the owner back to Providers.
4. After an Agent is published, its runtime is locked. The owner must fork the Agent to change it.

## Current availability

- **Claude Agent SDK** runs Anthropic Claude models.
- **OpenAI Runtime** runs OpenAI GPT models and custom OpenAI-compatible models that implement the Responses API.
- **OpenCode** can use Anthropic, OpenAI, DeepSeek, Gemini, Qwen, Kimi, Zhipu, MiniMax, OpenCode Zen, and custom OpenAI-compatible models.
- **Pi** runs the catalog's configured provider/model combinations and declared custom models through Responses, Chat Completions, Anthropic Messages, or Google Gemini. It supports text and tool execution, MCP, file changes, thinking, cancellation, usage, and native session resume. Product execution uses full access within the Session sandbox, without interactive tool approvals.

Custom models remain on OpenCode by default. Builders can explicitly select Pi for any of the four managed protocols, or OpenAI Runtime for Responses. New custom credentials default to Chat Completions and can declare a different protocol. An unsupported protocol/runtime combination is unavailable before execution. Pi's default identity remains an incomplete custom configuration until the caller selects a declared custom or preset model; adding access does not change the default runtime.

Protocol belongs to a provider/model endpoint, not the model's brand. OpenCode Zen models can use different protocols within the same provider. The named Gemini provider retains its existing OpenAI-compatible endpoint; a custom Google Gemini endpoint uses the native protocol. A compatible protocol alone does not add unsupported provider access to Claude Agent SDK or other restricted runtimes.

Existing custom credentials with no protocol retain their historical runtime-specific behavior until explicitly configured: Responses for OpenAI Runtime and Chat Completions for OpenCode/Pi. They must not be presented as protocol-tested. A new Session freezes its selected protocol; continuation rejects a conflicting credential change instead of switching the native conversation's protocol. Older custom Session snapshots infer their historical protocol by runtime. Custom model credential selection remains deterministic; a second credential is not silently chosen to bypass a protocol mismatch.

This API-key integration does not add Pi OAuth login, Bedrock signing, Vertex ambient credentials, or all capabilities of standalone Pi. Matching the protocol is necessary; the selected endpoint must also support streaming and tool calls used by the runtime.

The Providers page currently offers those nine named providers plus the custom-model action. A saved key unlocks only models that the selected runtime can run.

## Built-in tool restrictions

Only Claude Agent SDK supports disabling individual built-in tools. OpenAI Runtime, OpenCode, and Pi hide these switches and omit the all-enabled tool list from editable YAML. Explicit disabled settings remain visible as invalid configuration and must not be silently reset to enabled.

Console saves, API/CLI updates, package imports/forks, and publishing reject unsupported restrictions before writing an Agent or deployment version. Existing invalid configurations must be explicitly corrected before saving or publishing; this does not automatically repair an already published deployment.

Readiness and Session creation also reject an existing draft or published version with unsupported restrictions before creating a Session. Cold and cached Run preparation validate the frozen Session configuration before provisioning a runtime; changing the current Agent draft does not silently alter a published version or existing Session's tool policy.

## Product boundary

The runtime catalog exists to launch supported Agents reliably, not to become a provider marketplace. The exact provider list may change during Alpha; the stable product promise is a normalized managed runtime and API for supported Agent configurations.
