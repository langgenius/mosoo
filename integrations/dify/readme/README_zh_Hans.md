# mosoo managed agent for Dify

把一个已发布的 [mosoo](https://mosoo.ai) 智能体作为原生工具用于 Dify Agent、Chatflow 和 Workflow。mosoo 是 harness 中立的托管智能体运行时：Dify 只提交任务，模型、工具、沙箱、记忆和执行生命周期由 mosoo 管理。

`Dify -> mosoo Thread API -> 已发布 Agent -> 已配置 runtime + model`

## 能力

- 一个 **mosoo managed agent** 工具，支持新建 Thread、续聊和只等待三种模式。
- 返回标准最终答复，以及供 Workflow 分支使用的 `thread_id`、`run_id`、`status`、`error`。
- 长任务超时不会丢失：保存返回的 `thread_id`，再次调用并留空任务即可继续等待。
- API Token 只发送到固定地址 `https://cloud.mosoo.ai/api/v1`，不接受自定义主机。

## 配置步骤

1. 登录 [mosoo Cloud](https://cloud.mosoo.ai)，添加模型供应商密钥，创建并测试 Agent，然后发布。到 Agent 列表或设置中复制 26 位 Agent ID。
2. 打开 **Settings -> Access tokens**，填写标签并点击 **Create**，复制只显示一次的 `mst_...` Token。

![创建 mosoo API Token](../_assets/mosoo-api-token.png)

3. 在 Dify Marketplace 安装 **mosoo managed agent**。插件发布前，可在 **Plugins -> Install from local package** 上传构建好的 `mosoo.difypkg`。
4. 填入 mosoo API Token 和已发布 Agent ID。凭据校验只做只读请求。

![在 Dify 配置 mosoo](../_assets/dify-provider-config.jpg)

5. 在 Dify Agent 的 Tools 中添加 **mosoo managed agent**；或在 Chatflow/Workflow 添加 **Tool** 节点并选择它。

![在 Dify Workflow 使用 mosoo](../_assets/dify-workflow-tool.jpg)

## 用法

| 目标        | `prompt` | `thread_id` |
| ----------- | -------- | ----------- |
| 新建任务    | 必填     | 留空        |
| 继续 Thread | 必填     | 上次返回值  |
| 继续等待    | 留空     | 上次返回值  |

`timeout_seconds` 默认 120 秒（范围 10-240）。插件把 Dify runtime user 映射到 mosoo `userId`，并拒绝继续其他 Dify 用户的 Thread。返回 `waiting_input` 时，请先在 mosoo 处理权限或输入，再只带 `thread_id` 调用。

## Runtime 与模型检索索引

mosoo 提供统一 runtime 契约，不是 Dify 模型供应商。当前公开 runtime 为 **Claude Agent SDK**、**OpenAI Runtime** 和 **OpenCode**（ACP fallback）。当前 [mosoo runtime catalog](https://github.com/langgenius/mosoo/blob/main/pkgs/runtime-catalog/catalog/runtime-catalog.jsonc) 包含：

- Anthropic：`claude-fable-5`、`claude-sonnet-5`、`claude-opus-4-7`、`claude-opus-4-6`、`claude-opus-4-5`、`claude-sonnet-4-6`、`claude-sonnet-4-5`、`claude-haiku-4-5`。
- OpenAI：`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-5.5`、`gpt-5.4`、`gpt-5.4-mini`、`gpt-5.3`、`gpt-5.2`。
- DeepSeek、Gemini、Qwen、Kimi、Zhipu、MiniMax、OpenCode Zen：`deepseek-v4-pro`、`deepseek-v4-flash`、`gemini-3.5-flash`、`qwen3.7-plus`、`qwen3.6-plus`、`kimi-k2.6`、`kimi-k2.7-code`、`glm-4.7`、`glm-4.6`、`glm-5.2`、`MiniMax-M3`、`MiniMax-M2.7`、`minimax-m2.7`。

[AgentSky 的 harness 对比](https://agentsky.dev/use-cases/eval)提到 **Claude Code**、**Codex**、**Hermes**、**OpenClaw**。这里用于生态检索，不代表 mosoo 当前已可选择其中每一个。

<details>
<summary>ACP Registry 智能体索引（2026-08-11 核对，共 39 项）</summary>

来源：[Agent Client Protocol Registry](https://agentclientprotocol.com/get-started/registry)。进入 Registry 不等于 mosoo 支持承诺。

- Agoragentic (`agoragentic-acp`)、Amp (`amp-acp`)、Auggie CLI (`auggie`)、Autohand Code (`autohand`)、Claude Agent (`claude-acp`)、Cline (`cline`)、Codebuddy Code (`codebuddy-code`)。
- Codex (`codex-acp`)、Cortex Code (`cortex-code`)、Corust Agent (`corust-agent`)、crow-cli (`crow-cli`)、Cursor (`cursor`)、DeepAgents (`deepagents`)、Devin (`devin`)。
- DimCode (`dimcode`)、Dirac (`dirac`)、Factory Droid (`factory-droid`)、fast-agent (`fast-agent`)、Gemini CLI (`gemini`)、GitHub Copilot (`github-copilot`)、GitHub Copilot CLI (`github-copilot-cli`)。
- GLM Agent (`glm-acp-agent`)、goose (`goose`)、Grok Build (`grok-build`)、Harn (`harn`)、Junie (`junie`)、Kilo (`kilo`)、Kimi CLI (`kimi`)。
- Minion Code (`minion-code`)、Mistral Vibe (`mistral-vibe`)、Nova (`nova`)、OpenCode (`opencode`)、pi ACP (`pi-acp`)、Poolside (`poolside`)。
- Qoder CLI (`qoder`)、Qwen Code (`qwen-code`)、siGit Code (`sigit`)、Stakpak (`stakpak`)、VT Code (`vtcode`)。

</details>

## 安全、隐私与源码

任务会发送给 mosoo；已配置 Agent 可能调用远程模型、工具、MCP、网络或在沙箱内执行命令。发布 Agent 前请检查这些能力。插件自身没有持久化存储或分析埋点，详见 [PRIVACY.md](../PRIVACY.md)。

源码：[langgenius/mosoo](https://github.com/langgenius/mosoo/tree/main/integrations/dify) · 文档：[mosoo.ai/docs](https://mosoo.ai/docs/) · 支持：[GitHub Issues](https://github.com/langgenius/mosoo/issues) · 联系：[business@dify.ai](mailto:business@dify.ai)
