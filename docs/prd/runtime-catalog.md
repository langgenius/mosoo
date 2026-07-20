# Runtime Choice

Status: current core runtime surface under the canonical [mosoo Spec](../SPEC.md).

## Value

mosoo lets a Builder run an Agent Workload without learning how each model provider starts or operates it. Runtime choice exists to make supported workloads launch reliably; it is not a marketplace.

## Users and problem

The App Owner configures runtime access while creating and editing an Agent. They need to know which choices can run with the provider keys saved in the active App. Without clear availability, setup can end with a model that cannot launch. App Users should never need to know which runtime or provider powers the experience.

## Current flow

1. The App Owner adds a provider key in the active App, or adds a custom OpenAI-compatible model.
2. New Agent shows the available runtime choices and suggests a default based on configured keys.
3. In the Agent editor, the model picker offers models supported by the chosen runtime and unlocked by configured keys. A missing key sends the owner back to Providers.
4. After an Agent is published, its runtime is locked. The owner must fork the Agent to change it.

## Current availability

- **Claude Agent SDK** runs Anthropic Claude models.
- **OpenAI Runtime** runs OpenAI GPT models and custom OpenAI-compatible models that implement the Responses API.
- **OpenCode** can use Anthropic, OpenAI, DeepSeek, Gemini, Qwen, Kimi, Zhipu, MiniMax, OpenCode Zen, and custom OpenAI-compatible models.

Custom OpenAI-compatible models remain on OpenCode by default because some endpoints implement only Chat Completions. Builders can explicitly select OpenAI Runtime when the configured endpoint implements the Responses API.

The Providers page currently offers those nine named providers plus the custom-model action. A saved key unlocks only models that the selected runtime can run.

## Product boundary

The runtime catalog exists to launch supported Agents reliably, not to become a provider marketplace. The exact provider list may change during Alpha; the stable product promise is a normalized managed runtime and API for supported Agent configurations.
