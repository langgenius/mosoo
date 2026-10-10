# Runtime Choice

Which runtimes and models a Project can run, and how providers and model protocols fit together. The full runtime, provider and model matrix lives in the [runtime catalog](../../pkgs/runtime-catalog/); [SPEC](../SPEC.md) section 3 covers how a Session freezes its choice.

## Promises

- Four runtimes are selectable: Claude Agent SDK (`claude-agent-sdk`), OpenAI Runtime (`openai-runtime`), OpenCode (`acp-fallback`) and Pi (`pi`).
- A model is offered only when the chosen runtime supports it and the Project has a matching provider key; the model picker links to Providers for a missing key.
- Every provider/model endpoint speaks one model protocol: Chat Completions, Responses, Anthropic Messages or Google Gemini. Preset models use the protocol in the catalog. A custom provider declares one, and new custom credentials default to Chat Completions.
- OpenCode and Pi accept all four protocols, OpenAI Runtime only Responses, and Claude Agent SDK only Anthropic Messages for Anthropic models. A runtime and protocol pair that does not match is rejected before any execution.
- Custom providers are `openai-compatible` in the API. When a Project's only usable keys are custom, a new Agent in the console defaults to OpenCode; Pi or OpenAI Runtime runs custom models only when chosen explicitly. Pi's default is an incomplete placeholder until a preset model or a model declared on a custom credential is selected.
- Pi preserves the installed native catalog’s capabilities, limits and prices for an exact provider and model match, including through the model proxy.
- Pi’s advanced settings accept a thinking level; activation rejects levels that the selected native model cannot use. Omitting the setting keeps Pi’s default.
- Publishing does not lock an Agent's runtime or model.

## Limits

- Only Claude Agent SDK can disable individual built-in tools. The other runtimes reject an explicitly disabled tool instead of silently re-enabling it.
- Pi takes text input only; files reach it through the Session workspace. Pi uses mosoo-managed provider keys only: no Pi OAuth login, Bedrock signing or Vertex ambient credentials.
- Models absent from Pi’s native provider catalog use its generic text-only defaults without reasoning support or known pricing; metadata is never borrowed from another provider.
- A matching protocol does not prove that an endpoint supports the streaming and tool calls a runtime needs.
- Changing a custom credential's protocol breaks the Sessions that use it: their model calls are refused, and continuing them fails with a request to restore the protocol or start a new Session. A native conversation never switches protocols.
- A custom credential saved without a protocol keeps its old per-runtime route (Responses on OpenAI Runtime, Chat Completions elsewhere) until one is declared. A declared protocol cannot be cleared.
