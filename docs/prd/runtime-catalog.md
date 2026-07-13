# Runtime Choice

Status: current console behavior during migration to the canonical [Mosoo Spec](../SPEC.md).

## Value

Mosoo lets a Builder run an Agent Workload without learning how each model provider starts or operates it. Runtime choice exists to make supported workloads launch reliably; it is not a marketplace.

## Users and problem

The App Owner configures runtime access while creating and editing an Agent. They need to know which choices can run with the provider keys saved in the active App. Without clear availability, setup can end with a model that cannot launch. App Users should never need to know which runtime or provider powers the experience.

## Current flow

1. The App Owner adds a provider key in the active App, or adds a custom OpenAI-compatible model.
2. New Agent shows the available runtime choices and suggests a default based on configured keys.
3. In the Agent editor, the model picker offers models supported by the chosen runtime and unlocked by configured keys. A missing key sends the owner back to Providers.
4. After an Agent is published, its runtime is locked. The owner must fork the Agent to change it.

## Current availability

- **Claude Agent SDK** runs Anthropic Claude models.
- **OpenAI Runtime** runs OpenAI GPT models.
- **OpenCode** can use Anthropic, OpenAI, DeepSeek, Gemini, Qwen, Kimi, Zhipu, MiniMax, OpenCode Zen, and custom OpenAI-compatible models.

The Providers page currently offers those nine named providers plus the custom-model action. A saved key unlocks only models that the selected runtime can run.

## Launch boundary

This chooser is a migration baseline, not a launch promise. The canonical Spec commits to turning a supported repository into a hosted App with a reliable Agent Workload; it explicitly avoids a broad provider matrix, and App Users remain unaware of runtime choices. Launch acceptance therefore requires the supported workload to run, not preservation or expansion of this entire chooser.
