# App Builder（中文版）

App Builder 让 App 成为 Mosoo 的一等创建入口。在这份 PRD 中，App 指
Agent App：用户真正创建、打开、测试、发布和分发的产品单位。

一个 App 可以包含一个或多个 Agent。每个 Agent 都是 App 某一部分能力的平级
业务引擎，不是藏在通用 App 界面背后的实现辅助件。App Builder 不应预设
core Agent、primary Agent 或系统拥有的 Agent 上下级关系。如果一个 App 中
存在主从、协作或编排关系，那是用户自己设计出来的使用方式，不是平台假设。

## 产品定位

Mosoo 的创建体验应该从 Agent-first 转向 App-first。用户不应该一开始
就面对内部 Agent 分类、运行时机制或工具分类。他们应该从一个粗略的
产品目标开始：我想创建一个什么样的 App？

App 抽象位于 Agents 之上。它不会改变 Agent 拥有的运行时边界。

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
        │   ├── MCP servers
        │   └── Spaces
        ├── Preview / Logs / Cost
        └── Publish / API access / Channels
```

Thread 属于 Agent。Runtime resources 属于 Agent。App 是 Agents 之上的
产品级抽象，不是 Thread，不是运行时容器，也不是传统页面搭建器。

## 当前状态

当前产品界面仍然主要是 Agent-first。Web App 直接暴露 Agents，现有
Agent Builder 帮助用户创建或修改 Agent 草稿。这是 App Builder 的实现
基础，但不是最终产品表达。

代码证据：`apps/web/src/app/navigation.tsx`、`apps/web/src/app/route-registry.tsx`、`apps/web/src/routes/agent/components/create-agent-launcher.tsx`、`apps/web/src/routes/agent/lifecycle/lifecycle-shell.tsx`、`apps/web/src/routes/agent/components/agent-builder/agent-builder-panel.tsx`、`apps/api/src/modules/agent-builder/**`、`pkgs/contracts/src/agent-builder/**`。

当前已有一个纯前端 App Builder 原型：
`apps/web/src/routes/app-builder-mock/app-builder-mock.route.tsx`。它用于表达
目标 App-first 创建界面和发布 instruction 流程。这个原型是交互形态证据，
不是完整后端契约。

当前原型也表达了新的多 Agent Builder 形态：一个 App draft 拥有多个 Agent
draft，右侧表单区使用类似浏览器标签页的 Agent tabs，在多份可独立编辑的
Agent 表单之间切换。

## 决策摘要

最新产品决策如下：

- App 指 Agent App，是用户面对的产品单位。
- App Builder 支持一个 App draft 下创建多个 Agent draft。
- 每个 Agent 都是由 App 拥有的平级业务引擎。
- App Builder 不应预设 core Agent、primary Agent 或 Agent 上下级关系。用户
  可以在自己的 App 设计中决定 Agents 之间如何协作。
- Thread 位于 Agent 下。
- Runtime resources 位于 Agent 下。
- App Builder 必须保留完整配置表单，并帮助用户填写表单，而不是用聊天
  替代表单。
- 右侧配置区使用类似浏览器标签页的 Agent tabs。每个 tab 代表一个 Agent
  draft，并拥有一份独立、可编辑的 Agent 表单。
- App name 和状态这类 App 级 identity 属于 Agent tabs 上方的工作区 header，
  不应在每个 Agent tab 内重复出现。
- 每个 Agent tab 的标题就是可编辑的 Agent name，并必须和该 tab 表单里的
  Agent name 字段保持同步。
- 左侧 Builder composer 是 App draft 级的全局 composer。用户切换 Agent
  tabs 时它保持可见，并可以为任意 Agent 表单提出可见改动。
- Publish 是页面 header 里的 App 级生命周期动作，不是 Agent 表单底部的
  一个配置区块。
- 首屏创建界面应该提供 Agent App 模板。每个模板都可以在背后携带默认
  运行模式推荐。
- 主创建流程不应该要求用户选择 Assistant Agent、Task Agent 这类内部分类。
- 如果 Agent 表单暴露行为模式，字段名应为 `How it runs`，并描述用户能感知
  到的该 Agent 行为。
- 进度模型是 `Agent → Space → Environment → Test`。
- `Test` 是最终创建节点，代表 App 配置的一个或多个 Agent 可以被 Thread 触达。
- Publish 会把 App 配置的一个或多个 Agent 启动到线上 Cloudflare runtime，
  并按照访问设置让 App 进入线上可访问状态。
- 发布同时生成 `instruction.md`，这是给外部 Coding Agent 使用的平台中立
  开发指令文件。
- `instruction.md` 不是 Skill，不是运行时产物，也不会被 Agent App 自己的
  Agent 消费。
- Publish 后应先展示准备中反馈，再打开 instruction 弹窗。
- Publish 完成后，Publish 按钮应变成 `Published` 下拉入口，其中包含
  `instruction.md` 和 `Unpublish` 操作。

## 产品原则

1. 从 App 目标开始，而不是从 Agent 分类开始。
2. 明确保留 Agents，因为它们是 App 的业务引擎。
3. 完整配置表单必须可见、可编辑。
4. App Builder 是表单辅助层，不是表单替代品。
5. AI 生成的改动必须通过可见表单值变得可审查。
6. 支持多个 Agent，但不隐藏每个 Agent 自己的表单。
7. Thread 和 runtime resource 的所有权保持在 Agent 下。
8. 在发布时生成开发 instruction 上下文，而不是在创建过程中维护一份实时 PRD。

## 目标流程

当用户打开 App 且当前没有 App 时，Mosoo 应显示直接创建入口，而不是空表
或设置清单。

```text
Open App
→ 空状态询问想创建什么 App，并提供 Agent App 模板
→ 用户提交模糊需求
→ 创建 App 草稿
→ 进入 App 创建页面
→ 展示完整的 Agent tabs 配置区
→ App Builder 将用户意图转译为可见表单值
→ 用户审查或手动编辑 App 级 header 字段和 Agent tab 表单
→ 用户通过 Thread 在 Chat 中测试
→ 用户发布
→ Mosoo 将 App 配置的一个或多个 Agent 启动到线上 Cloudflare runtime
→ Mosoo 准备 instruction.md
→ Mosoo 展示 App published 弹窗
→ Publish 入口变成 Published
```

初始提示可以是类似 “What kind of App do you want to create?” 的简单问题。
用户可以输入不完整或模糊的需求。按下 Enter 后创建草稿并进入 App 创建页。

同一个首屏也应提供一组 Agent App 模板，例如 Support assistant、Sales
follow-up、Report generator、Image gallery、Data monitor、Workflow
automation。模板不只是文案快捷入口：每个模板都可以在背后设置默认 Agent
behavior、tools、Spaces、prompt pattern 和 environment expectation。

## App 创建页面

App 创建页面必须展示完整配置表单。App Builder 不隐藏表单，也不把体验变成
黑盒聊天流程。表单仍然是可运行配置的事实来源。

App Builder 是挂在表单旁边的 AI 辅助层。它通过把自然语言需求转译为可见
字段变化，帮助用户填写、修改和理解表单。

App Builder 应帮助处理：

- App 级命名和生命周期意图。
- 在一个 App 下创建、命名和编辑多个 Agent。
- 每个 Agent 的角色和行为。
- 每个 Agent 的 Prompt 内容。
- Model 和 Provider 建议。
- Environment 选择或创建建议。
- Skill、MCP server、Space 绑定建议。
- 需要反向影响配置的 Thread 测试反馈。

一级创建页面应包含：

- Builder 对话区域，用于模糊需求、澄清问题和变更请求。这个 composer 是
  App draft 级全局入口，不是某个隐藏 Agent tab 的私有聊天。
- 顶部 App header，包含可编辑 App name、App 状态、Test 和 Publish 操作。
- 右侧 Agent tab 配置区，按可独立编辑的 Agent drafts 分组：
  - 表单区顶部展示类似浏览器标签页的 Agent tabs。
  - 一个 tab 对应一个 Agent draft。
  - tab 标题等于该 Agent 表单里可编辑的 Agent name。
  - 每个 tab 内包含 Agent name、Agent description、`How it runs`、
    model/provider、system prompt、Skills、MCP servers、Spaces 和 Environment
    字段。
  - 切换 tab 只改变当前可见的 Agent 表单，不应覆盖、复制或重置其他
    Agents 的表单值。
- Test in Chat 入口，用于创建或打开 Thread 做验证。
- Publish 按钮，用于启动线上发布流程并打开 App published 弹窗。
- 发布成功后的 Published 下拉入口。

右侧表单区不应在每个 Agent tab 内重复 App identity 区块。App 级 identity
属于顶部 header。Agent 级 identity 属于每个 Agent 表单内部。

## 多 Agent 的可见性与可编辑性

App Builder 创建工作区支持在一个 App draft 下创建多个 Agent draft。左侧
Builder composer 是 App draft 级的单一全局 composer。用户切换右侧 Agent
tabs 时，composer 保持可见，不会变成隐藏的单 Agent 聊天。

右侧配置区使用类似浏览器标签页的 Agent tabs。每个 tab 代表一个 Agent
draft，并拥有一份独立、可编辑的 Agent 表单。切换 tab 只切换当前可见的
Agent 表单，不应覆盖或复制其他 Agents 的表单值。

每个 Agent tab 的标题就是 Agent name。用户在表单里编辑 Agent name 时，tab
标题必须同步更新。App name 这类 App 级 identity 属于工作区顶部 header，不在
每个 Agent tab 内重复出现。

Builder 生成的改动必须以可见字段值的形式可审查。当 Builder 修改某个 Agent
时，应激活对应 Agent tab，或以其他清晰方式标明目标 Agent。用户可以切换所有
tabs 查看并手动编辑每一份 Agent 表单。

## 内部 Agent Type 处理

App 创建页面不应该强迫用户在 Assistant Agent 和 Task Agent 这类可见内部
分类之间做选择。

这个选择会在用户表达自己想做什么 App 之前增加认知成本，也会限制用户想象力，
让用户误以为 Mosoo 只能创建这两类 App。

产品行为：

- 用户用产品语言描述 App 目标。
- Agent App 模板可以根据业务模式设置默认运行模式推荐。
- App Builder 拥有一个可变的推荐运行模式字段，并可以根据用户需求或后续
  对话更新它。
- 如果内部 Agent type 仍然必要，应被推断、默认化，或移动到高级运行时设置。
- 主 App 创建路径不应从这个 taxonomy 开始，也不应围绕它展开。

如果 Agent 表单暴露行为模式，应使用 `How it runs`。可见选项应描述用户感知
到的 Agent 行为，例如 `Ongoing` 表示 Agent 可以跨 Session 延续工作，
`One-off` 表示每个 Session 都作为独立任务处理。`Recommended` 是由 App
Builder 控制的表单值，不是前端写死的标签。内部映射到 Assistant-like 或
Task-like runtime behavior 仍然是实现细节。

App Builder 应将建议改动展示为可见 patch，或清楚反映到表单值中。用户必须
能够审查、编辑或拒绝生成的配置。

## 进度模型

App 创建页面应使用符合真实创建路径的进度：

```text
Agent → Space → Environment → Test
```

进度定义：

- Agent：App 的 Agent drafts 已有足够的 identity、model、prompt 和行为配置，
  可以作为 App 的业务引擎运行。对于多 Agent App，每个 Agent tab 都应让自己
  的 readiness 可见。
- Space：App 已绑定所需 workspace、知识或业务上下文。
- Environment：运行环境已选择或准备好，所需 runtime resources 可触达。
- Test：Test in Chat 已验证 App 可以通过 Thread 触达，并且选中的 Agent 或
  App 测试目标可以在该环境中响应。

`Test` 是最终进度节点。发布是否允许取决于产品对测试要求的定义；如果不满足，
应明确显示缺失的测试状态。

## 事实来源

MVP 不应该在每个 Builder turn 中维护单独的实时 PRD 文档。这样可以避免 PRD
文本、表单值和手动编辑之间复杂的同步问题。

MVP 的事实来源模型如下：

- App header 是创建工作区中 App 级 identity 和生命周期状态的事实来源。
- 每个 Agent tab 表单是该 Agent 可运行配置的事实来源。
- Agent tab 标题由可编辑的 Agent name 字段派生。
- App Builder 对话历史是 App 级全局需求上下文。
- Thread 测试反馈是需求上下文。
- 发布时导出可以把这些上下文总结成平台中立的开发 instruction 产物。

Mosoo 在 MVP 阶段不应实现 PRD 和表单的双向同步。不应引入 “PRD 已变更，
配置待同步” 或 “配置已变更，PRD 待同步” 状态，除非产品验证实时 PRD 编辑
确实必要。

## App Manifest YAML 契约

当前代码里有两类和 Agent YAML 相关的结构：

- 现有导入 / 导出路径是单 Agent 契约。`AgentManifest` 位于
  `pkgs/contracts/src/agent/agent-manifest.contract.ts`，并由
  `serializeAgentManifestToYaml` 序列化。它的稳定 section 是
  `manifestVersion`、`kind`、`metadata`、`runtime`、`prompts`、`skills`、
  `mcpServers`、`environment`、`spaces` 和 `advanced`。
- 当前 Agent editor draft YAML 位于
  `apps/web/src/routes/agent/components/editor/draft.ts`。它是表单编辑形态，
  包含 `version: 1`、`identity`、`kind`、`runtime`、`prompt`、
  `environment`、`assets` 和可选 `builder` metadata。

这两者都不是多 Agent App YAML。App Builder 应引入 App 级 manifest：复用当前
Agent manifest 的配置 section，但把它们汇总到一份 App 文档里。

App Builder 的 canonical YAML 是一份 App-level manifest：

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
    spaces: []
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
    spaces: []
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

YAML 规则：

- App manifest 是 App Builder、publish、import 和 export 的 canonical YAML。
  它包含一个 `agents` list，不是一份 Agent 一份 YAML。
- 可以把拆文件作为开发者便利能力，例如 `app.yaml` 加 `agents/<key>.yaml`。
  但 import 或 publish 前必须把拆分文件编译回同一份 App manifest 后再校验。
- 每个 `agents[]` item 必须遵循同一套 `AgentSpec` 结构。空 section 应用
  `[]`、`{}` 或 `null` 表达，不允许每个 Agent 自己发明替代字段。
- `agents[].key` 是本 manifest 内稳定的本地 key，用于 tab identity、relations
  和 import。它不是展示名，也不应被当作源 App 的平台 ULID。
- `agents[].metadata.name` 是 Agent name，并驱动 Agent tab title。
- `agents[].behavior.mode` 是面向产品的 `How it runs` 值。它可以是 `ongoing`
  或 `one_off`。实现可以把它映射到现有内部 Agent `kind`，但 App YAML 不应暴露
  core/primary Agent，也不应暴露 Agent 上下级关系。
- `runtime`、`prompts`、`skills`、`mcpServers`、`environment` 和 `spaces`
  有意贴近当前单 Agent manifest section，方便实现复用现有 parser、serializer、
  readiness、import 和 repair 概念。
- `relations` 是可选且由用户定义的。它可以描述 handoff、orchestration、routing
  或其他协作模式，但永远不创建平台预设的上下级关系。
- 未知 root fields 无效。扩展数据必须放在明确的 `extensions` 对象里。
- extension keys 必须带 namespace，例如 `x-mosoo`、`x-provider-openai` 或
  `x-team-acme`。不允许非 namespaced 的任意字段。
- `advanced.unparsedFields` 保留给现有 AgentManifest 概念的兼容用途。新的 App
  Builder 扩展数据应使用 `extensions`，不要使用 `advanced.unparsedFields`。
- YAML 中不得出现 secrets、plaintext provider keys、OAuth tokens、webhook
  signing secrets 或 personal credentials。

## 发布生命周期与开发 Instruction

当用户发布 App 时，Mosoo 会把 App 配置的一个或多个 Agent 启动到线上
Cloudflare runtime。App 按照自己的访问设置进入 published、online-accessible
生命周期状态。

发布同时生成一个给外部 Coding Agent 工作流使用的 `instruction.md` 文件。
这个文件在发布时生成，不会在每个 Builder turn 中持续维护。

生成文件是开发 instruction 文件。它不是 Skill，不是运行时工具，也不是挂载回
Agent App 的内容。它是外部 Coding Agent 使用的可移植上下文和指令。

这个文件必须由 App Builder 生成，因为 App Builder 拥有创建对话、表单编辑、
推断意图和 Thread 测试反馈。用户不应在另一个 coding 工具里重新复述 App 目标。

发布流程应是 App 生命周期体验，并在 App 上线后展示 instruction 弹窗。Mosoo
可以显示短暂的 “Publishing App...” 状态，同时完成：

- 将 App 配置的一个或多个 Agent 启动到线上 Cloudflare runtime。
- 应用发布和访问状态。
- 收集初始 App 创建需求。
- 总结 App Builder 对话历史。
- 包含 App ID 和 Agent IDs。
- 从 Builder 上下文总结简短 PRD。
- 包含相关 Thread 测试反馈。
- 捕获发布和分发意图。

生成的 `instruction.md` 应帮助外部 Coding Agent 理解：

- 用户正在构建什么 Agent App。
- Mosoo CLI 和 OpenAPI 调用所需的 App ID 与 Agent IDs。
- App 面向谁。
- App 解决什么问题。
- 每个 Agent 应该做什么。
- 对话中提到的用户偏好或边界。
- 什么不应该被改变或假设。
- 接下来实现时重要的上下文。

instruction 不应内嵌完整 App 配置快照。App 配置应在需要时通过 Mosoo CLI
或 OpenAPI 按 App ID 拉取。这样可以让 instruction 更短，也避免配置数据过期。

## Instruction 生成规则

App Builder 应按以下流程生成 `instruction.md`：

1. 收集当前 App ID 和 Agent IDs。
2. 收集 Builder 对话历史、初始用户需求、已接受的表单改动和 Thread 测试反馈。
3. 从这些上下文总结一份简短 PRD。
4. 添加 Node/npm、Mosoo CLI、Mosoo auth、Cloudflare Wrangler 和 Cloudflare
   auth 的设置指令。
5. 添加 API Reference 链接和 Mosoo CLI inspection 命令。
6. 添加 Mosoo CLI skill 拉取指令，让外部 Coding Agent 能加载 CLI 使用指南。
7. 添加 harness 和 guardrail 指令，说明哪些能力已经由 Mosoo 负责。
8. 渲染为结构化 Markdown 文件。

生成约束：

- 不包含 secrets、access tokens、private API keys 或用户凭证。
- 不包含完整 App 配置快照。
- 不要求 Coding Agent 重建 Agent runtime、Sandbox、Thread runtime、model
  orchestration、Environment infrastructure 或 Mosoo 已拥有的 Agent behavior。
- 不暴露内部 App Builder 实现细节。
- 不指向某个特定外部 Coding Agent 平台。
- 优先在 fenced `bash` blocks 中给出直接命令。
- 优先使用简短、命令式的 instruction，而不是长篇解释。
- 保持 instruction 足够聚焦，能够舒适地放进外部 Coding Agent 的上下文窗口。

## Instruction 模板

生成的 `instruction.md` 应遵循以下结构：

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

流程：

```text
用户点击 Publish
→ Mosoo 显示短暂准备中状态
→ Mosoo 将 App 配置的一个或多个 Agent 启动到线上 Cloudflare runtime
→ Mosoo 按访问设置让 App 线上可访问
→ Mosoo 总结 Builder 对话 + App ID + Agent IDs + Thread 测试反馈
→ Mosoo 渲染平台中立的 instruction.md
→ Mosoo 打开 App published 弹窗
→ 用户可以审查和编辑 instruction.md
→ 用户可以复制或下载当前编辑后的 instruction.md
→ 用户可以从次要位置打开 API Reference
→ 用户关闭弹窗
→ Publish 按钮变成 Published
→ 用户可以从 Published 下拉中重新打开 instruction.md 或 Unpublish
```

弹窗要求：

- 标题应确认发布成功，例如 “App published”。
- 标题和正文不应提到特定 Coding Agent 产品。
- 在小的带边框滚动区域中展示完整 `instruction.md` 内容。整个弹窗不应变成
  一个很长的文档阅读器。
- `instruction.md` 预览必须可在复制或下载前编辑。
- Copy 和 Download 必须使用用户当前编辑后的内容。
- 用户编辑预览后，应重置复制成功状态。
- 提供 Copy 操作。
- 提供 Download 操作。
- 下载文件名应为 `instruction.md`。
- 生成文件中必须包含 App ID 和 Agent IDs。
- 告诉 Coding Agent 在需要配置细节时，通过 App ID 拉取当前 App 配置。
- 说明用户可以把这些 instructions 交给外部 Coding Agent，并配合 Mosoo CLI
  和 API Reference 继续 App 开发。
- API Reference 链接应位于次要位置，例如弹窗左下角。
- instruction 弹窗中不要放主要的 Test in Thread 按钮。Thread 验证属于 App
  创建页 header 或主测试流程，不属于 instruction 文件操作。

准备中状态要求：

- 点击 Publish 后不应立刻打开最终弹窗。
- 在 mock 中显示一个大约两秒钟的小型浮层准备状态。
- 准备中浮层应表达 Mosoo 正在发布 App：启动线上配置的一个或多个 Agent，并
  准备 `instruction.md`。
- 等待期间 Publish 按钮应显示 publishing 文案和 spinner。

发布后状态要求：

- 配置的一个或多个 Agent 上线且 instruction 弹窗生成后，主 publish 入口应
  变成 `Published`。
- `Published` 应是一个下拉触发器，而不是第二个主发布操作。
- 下拉中应包含 `instruction.md`，用于重新打开同一个 instruction 弹窗。
- 下拉中应包含 `Unpublish`，用于让 App 回到未发布状态。
- 如果用户在发布后修改 App 配置或 Builder 内容，App 应回到未发布草稿状态，
  因为之前的 instruction 可能已经无法匹配当前表单。

产品规则：`instruction.md` 是给外部 Coding Agent 使用的开发 instruction
产物，不是 Agent App 运行时产物，也不是 Skill。
Publish 是 App 生命周期动作。Instruction 生成是发布的伴生产物，不是发布的
定义本身。

## Thread 测试

测试应引导用户确认 Thread reachability，因为 Thread 属于 Agent，也是证明
App 可用的交互面。

如果最终 Thread 页面尚未完成，MVP 可以先 mock 这个目标页面。即使是 mock，
也应表达目标契约：

- Test in Chat 会为选中的 Agent 或 App 配置的测试目标创建或打开 Thread。
- Thread 可以触达已选择的 Environment。
- Agent 可以使用当前表单配置响应。
- 测试反馈可以回到 App Builder，并反映到表单中。

## 原型与截图策略

PRD 不应为每一个 UI 点位嵌入截图。这样会让 PRD 维护成本很高，也会把文档
变成脆弱的视觉 QA 产物。

截图只应作为稳定、高风险交互状态的轻量证据。精确像素的事实来源是前端原型
和设计实现，不是这份 Markdown PRD。

需要评审截图时，只截以下状态：

1. App 创建页面，包含 Builder chat、Agent tabs、完整表单和
   `Agent → Space → Environment → Test` 进度。
2. 点击 Publish 后的准备中浮层。
3. App published 弹窗，包含可编辑 `instruction.md`、Copy、Download 和次要
   API Reference 链接。
4. Published 下拉，包含 `instruction.md` 和 `Unpublish`。

除非设计评审明确要求视觉证据，否则不要求为每个字段、下拉项、hover 状态或
文案变体截图。

## MVP 要求

1. 增加 App-first 入口和空状态创建提示。
2. 从模糊用户需求创建 App 草稿。
3. 提交后打开一级 App 创建页面。
4. 保持完整配置表单可见且可编辑。
5. 支持在一个 App draft 下创建多个 Agent draft。
6. 将 Agent drafts 表达为右侧 Agent tabs，每个 tab 拥有一份独立、可编辑的
   Agent 表单。
7. 切换 Agent tabs 时，左侧 Builder composer 仍然可见，并可以为任意 Agent
   表单提出可见改动。
8. App 级 identity 位于页面 header，不放进每个 Agent tab。
9. 将 App Builder 作为 AI 辅助层挂到表单旁，把用户意图转译为表单变化。
10. 将 App Builder YAML contract 定义为一份 App-level manifest，其中包含同构
    `agents[]` list。
11. YAML 扩展数据只能放在 namespaced `extensions` 对象里。
12. 主创建流程不要求用户选择可见内部 Agent 分类。
13. 使用 `Agent → Space → Environment → Test` 作为创建进度模型。
14. 保留 Builder 对话上下文，供后续总结使用。
15. 允许 Thread 测试反馈继续通过 App Builder 和表单编辑回流。
16. 发布时将 App 配置的一个或多个 Agent 启动到线上 Cloudflare runtime。
17. 将简洁的开发 instruction 文件作为发布的伴生产物生成。
18. 通过 App published 弹窗暴露生成的 `instruction.md`，并提供复制和下载操作。
19. 在发布 instruction 中包含 App ID、Agent IDs、API Reference 入口和 Thread
    测试指引。
20. instruction 预览可编辑，并使用编辑后的内容进行复制和下载。
21. 在 App published 弹窗打开前展示 publishing 状态。
22. 发布成功后将 Publish 变成 `Published` 下拉。
23. 允许用户从 `Published` 下拉重新打开 `instruction.md` 或执行 Unpublish。

## 非目标

- 不构建传统 no-code 页面搭建器。
- 不把 App 当作 Thread。
- 不把 Threads 从 Agent 下移走。
- 不把 runtime resources 从 Agent 下移走。
- 不把配置表单藏在纯聊天体验后面。
- 不在主 App 创建流程中强迫用户选择内部 Agent type taxonomy。
- 不把多个 Agent drafts 折叠成一份隐藏或共享表单。
- 不把 Builder composer 限制为只能编辑当前可见的 Agent tab。
- 不把 App Builder 的 canonical YAML 做成一份 Agent 一份文件。
- 不允许每个 Agent 自己发明不同 YAML 结构。
- 不把非 namespaced 的任意字段当作 extension data 接受。
- 不静默覆盖用户手动编辑的字段。
- 不在 MVP 创建过程中维护实时 PRD 文档。
- 不在 MVP 中构建 PRD / 表单双向同步。
- 不把生成的 instruction 文件描述成 Skill。
- 不在生成 instruction 文件中嵌入完整 App 配置快照。
- 不让生成 instruction 听起来只适用于某一个外部 Coding Agent 平台。
- 不把 PRD 当成穷尽式截图归档。
- 不在 instruction 弹窗中放主要 Thread 测试 CTA。

## 验收标准

- 新用户可以从 App 入口开始，输入模糊需求，并进入 App 创建页。
- App 创建页清楚展示完整表单和 App Builder 辅助。
- App 创建页可以在一个 App draft 下表达多个 Agent。
- 右侧配置区展示 Agent tabs，每个 tab 拥有一份独立、可编辑的 Agent 表单。
- 切换 Agent tabs 时，每个 Agent 的表单值保持不变。
- 编辑 Agent name 会同步更新对应 Agent tab 标题。
- App name 可以在 header 中编辑，并且不会在每个 Agent tab 内重复出现。
- 切换 Agent tabs 时，Builder composer 保持可见，并可以通过可见改动作用到
  任意 Agent 表单。
- App Builder YAML 是一份 App-level manifest，并包含同构 `agents[]` list。
- 每个 Agent entry 都使用同一套 `AgentSpec` sections，即使某些 section 为空。
- extension data 只能通过明确的 namespaced `extensions` 对象接受。
- 用户不需要理解或选择内部 Agent type taxonomy 就能创建 App。
- App Builder 可以把用户请求转译为可见配置变化。
- 用户在任何时候都可以手动编辑表单。
- 进度展示为 `Agent → Space → Environment → Test`。
- Test in Chat 可以验证选中 Agent 或 App 测试目标的 Thread reachability；
  即使第一版使用 mock Thread 目标，也要表达这个契约。
- 发布会将 App 配置的一个或多个 Agent 启动到线上 Cloudflare runtime。
- 发布打开 App published 弹窗。
- 发布将 `instruction.md` 作为伴生产物生成，内容来自对话历史、App ID、
  Agent IDs、简短 PRD 内容和 Thread 测试反馈。
- App published 弹窗出现前展示短暂 publishing 状态。
- 生成的 instruction 告诉 Coding Agent 通过 App ID 拉取当前 App 配置，而不是
  依赖内嵌配置快照。
- 生成文件明确标识为给外部 Coding Agent 使用的开发 instruction 产物。
- 发布弹窗同时提供 Copy 和 Download 操作。
- 发布弹窗允许用户在复制或下载前编辑 `instruction.md`。
- 发布弹窗包含次要 API Reference 链接。
- 关闭发布弹窗后，App 保持 `Published` 状态。
- `Published` 下拉可以重新打开 `instruction.md`。
- `Published` 下拉可以 Unpublish App。
- 发布后编辑 App 配置会让 App 回到未发布草稿状态。
