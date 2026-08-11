# mosoo managed agent for Dify

Run one published [mosoo](https://mosoo.ai) Agent as a native tool in Dify Agents, Chatflows, and Workflows. mosoo is the harness-neutral managed Agent runtime; Dify sends a task, and mosoo owns the configured model, tools, sandbox, memory, and execution lifecycle.

`Dify -> mosoo Thread API -> published Agent -> configured runtime + model`

## What you get

- One `mosoo managed agent` tool for starting, continuing, or waiting on a durable Thread.
- Canonical final output plus `thread_id`, `run_id`, `status`, and a public-safe error for Workflow branching.
- Recovery for long tasks: a timeout returns `thread_id`; call the tool again with that ID and no task.
- A fixed `https://cloud.mosoo.ai/api/v1` destination. The plugin never sends your token to a custom host.

## Setup

1. In [mosoo Cloud](https://cloud.mosoo.ai), add a model-provider key, create an Agent, test it, and publish it. Copy the 26-character Agent ID from the Agent list or settings.
2. Open **Settings -> Access tokens**, enter a label, click **Create**, and copy the `mst_...` token shown once.

![Create a mosoo API token](./_assets/mosoo-api-token.png)

3. In Dify, install **mosoo managed agent** from Marketplace. Before publication, upload the built `mosoo.difypkg` from **Plugins -> Install from local package**.
4. Configure the provider with the mosoo API token and published Agent ID. The credential check is read-only.

![Configure mosoo in Dify](./_assets/dify-provider-config.jpg)

5. Add **mosoo managed agent** under an Agent's tools, or add a **Tool** node in a Chatflow/Workflow and select it.

![Use mosoo as a Dify Workflow tool](./_assets/dify-workflow-tool.jpg)

## Use

| Goal              | `prompt` | `thread_id`  |
| ----------------- | -------- | ------------ |
| Start work        | Required | Empty        |
| Continue a Thread | Required | Prior output |
| Wait longer       | Empty    | Prior output |

`timeout_seconds` defaults to 120 (10-240). The tool maps the Dify runtime user to mosoo `userId` and refuses to continue a Thread owned by another Dify user. A `waiting_input` result means the Agent needs a permission or input resolved in mosoo; then call again with `thread_id` only.

## Runtime and model search index

mosoo provides a normalized runtime contract rather than a Dify model provider. Current public runtime choices are **Claude Agent SDK**, **OpenAI Runtime**, and **OpenCode** (ACP fallback). The current [mosoo runtime catalog](https://github.com/langgenius/mosoo/blob/main/pkgs/runtime-catalog/catalog/runtime-catalog.jsonc) contains:

- Anthropic: `claude-fable-5`, `claude-sonnet-5`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-opus-4-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5`.
- OpenAI: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3`, `gpt-5.2`.
- DeepSeek, Gemini, Qwen, Kimi, Zhipu, MiniMax, OpenCode Zen: `deepseek-v4-pro`, `deepseek-v4-flash`, `gemini-3.5-flash`, `qwen3.7-plus`, `qwen3.6-plus`, `kimi-k2.6`, `kimi-k2.7-code`, `glm-4.7`, `glm-4.6`, `glm-5.2`, `MiniMax-M3`, `MiniMax-M2.7`, `minimax-m2.7`.

[AgentSky's harness comparison](https://agentsky.dev/use-cases/eval) mentions **Claude Code**, **Codex**, **Hermes**, and **OpenClaw**. They are included here for ecosystem discovery, not as a claim that every one is currently selectable in mosoo.

<details>
<summary>ACP Registry agent index (39 entries checked August 11, 2026)</summary>

Source: [Agent Client Protocol Registry](https://agentclientprotocol.com/get-started/registry). Registry presence is not a mosoo support promise.

- Agoragentic (`agoragentic-acp`), Amp (`amp-acp`), Auggie CLI (`auggie`), Autohand Code (`autohand`), Claude Agent (`claude-acp`), Cline (`cline`), Codebuddy Code (`codebuddy-code`).
- Codex (`codex-acp`), Cortex Code (`cortex-code`), Corust Agent (`corust-agent`), crow-cli (`crow-cli`), Cursor (`cursor`), DeepAgents (`deepagents`), Devin (`devin`).
- DimCode (`dimcode`), Dirac (`dirac`), Factory Droid (`factory-droid`), fast-agent (`fast-agent`), Gemini CLI (`gemini`), GitHub Copilot (`github-copilot`), GitHub Copilot CLI (`github-copilot-cli`).
- GLM Agent (`glm-acp-agent`), goose (`goose`), Grok Build (`grok-build`), Harn (`harn`), Junie (`junie`), Kilo (`kilo`), Kimi CLI (`kimi`).
- Minion Code (`minion-code`), Mistral Vibe (`mistral-vibe`), Nova (`nova`), OpenCode (`opencode`), pi ACP (`pi-acp`), Poolside (`poolside`).
- Qoder CLI (`qoder`), Qwen Code (`qwen-code`), siGit Code (`sigit`), Stakpak (`stakpak`), VT Code (`vtcode`).

</details>

## Security, privacy, and source

Tasks are sent to mosoo and may cause the configured Agent to use remote models, tools, MCP servers, network access, or sandboxed command execution. Review the Agent before publishing it. The plugin has no storage or analytics; see [PRIVACY.md](./PRIVACY.md).

Source: [langgenius/mosoo](https://github.com/langgenius/mosoo/tree/main/integrations/dify) · Docs: [mosoo.ai/docs](https://mosoo.ai/docs/) · Support: [GitHub issues](https://github.com/langgenius/mosoo/issues) · Contact: [business@dify.ai](mailto:business@dify.ai)
