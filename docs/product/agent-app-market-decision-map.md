# Mosoo Agent App 市场决策地图

> 状态（2026-07-07）：#16–#25 的全部决策已收敛进单一事实来源 [docs/prd/mosoo-native-deployment-protocol.md](../prd/mosoo-native-deployment-protocol.md)。其中两条已被 2026-07-06 design session 的 locked decisions 修订并在 PRD 中标注 Superseded：#17（文本-only validator → doctor 式版本化 JSON）、#24（一次性 Agent API token → v1 认证走 account PAT）。本文保留为决策依据存档 + 附录市场原始材料；市场线（fork / distribution / community）的技术前置 = portability SLO，Fork-someone's-app 推迟到 market phase（见 workplan）。

## #16：Native spec/version 字段怎么定义？

依赖：Native protocol spec 草案
类型：讨论

### 问题

目标协议需要公开版本号 `mosoo.spec.v1`。Mosoo 仍在 alpha，不需要为当前 `.mosoo.toml schema = 1` 做长期兼容；那目标 shape 应该使用什么字段或文件名，才能让 coding agent 清楚识别 Native protocol？

### 答案

已解决。

采用根目录 `.mosoo.toml` 顶层字段：

```toml
spec = "mosoo.spec.v1"
```

每个 Mosoo Native repo 都必须有根目录 `.mosoo.toml`，即使它是 Agent-only repo，最小内容也只需要这一行。这个文件不是 Web config 的可选载体，而是“这个 repo 是 Mosoo Native Deployable”的显式声明。

原因：Mosoo Deploy 已经决定不做通用 repo detector。缺少 `.mosoo.toml` 时，validator 应该明确失败并要求 coding agent 创建 Mosoo Native protocol 文件，而不是尝试把普通 repo 猜成 Mosoo app。当前 `.mosoo.toml schema = 1` 是 alpha 现状，不是长期兼容约束；目标 parser 不能把 `spec = "mosoo.spec.v1"` 示例误当作当前已实现能力。

## #17：Native dry-run validator 的最小验证契约是什么？

依赖：#16
类型：讨论

### 问题

为了让 coding agent 学会 Mosoo Native，Native dry-run validator 最小必须输出什么结构，才足以形成修复循环？

### 答案

已解决。

MVP 只承诺人类可读文本输出，不提供 `--json`，也不承诺稳定 machine-readable deployment plan schema。输出必须足够让 coding agent 读懂并修复：每条诊断包含 severity、file、field、problem、fix action，并区分 `error`、`warning`、`setup_required`。

缺 credential 不能被误报成 schema error；post-deploy OAuth、扫码、token 填写进入 `setup_required`。`mosoo deploy --dry-run` 可以报告 setup_required 和 preview facts，但不创建资源、不创建 token。后续如果要做 JSON/CI 集成，可以另开版本；不进入一月 MVP。

## #18：Mosoo Deploy CLI 要解决什么问题？

依赖：#16、#17
类型：讨论

### 问题

用户或 coding agent 已经写好 Mosoo Native 文件后，需要一个本地命令把这个仓库 deploy 到 Mosoo。这个命令要解决什么问题，和 Web/Lens 上的上线入口如何分工？

### 答案

已解决。

当前判断：用户-facing 语义就是 deploy，目标命令名使用 `mosoo deploy`。它解决的是 coding agent 写完文件之后，没有一个 canonical feedback loop 和 deploy entry 的问题：读取 Native files、验证、输出部署预览和可修复错误，并把仓库部署成 App-local Agents、resources、exposures、deployments。Web/Lens 可以展示同一份部署预览、setup requirements 和 deploy 结果，但不应替代 coding agent 可运行的 CLI 验证/部署路径。

## #19：一个月 MVP 的 deploy outputs 是哪些？

依赖：#18
类型：讨论

### 问题

三人团队一个月发布，不能同时做完 Channel、Web 复杂绑定、复杂资源复用。首发 `mosoo deploy` 应该输出什么？

### 答案

已解决。

当前判断：每个 deployed Agent 默认输出 Agent API Endpoint / OpenAPI；Web repo 额外输出 Web deployment。证据：Public Thread API / OpenAPI / PAT 路径已经存在；`AppDeployment`、`AppDeploymentRun`、`.mosoo.toml schema = 1` AppDeployment override、`deployApp` GraphQL operation 已经存在。Channel Binding 还没做出来，当前不考虑。Multi-agent 已是当前能力，不应该作为 MVP 削减项。

## #20：Agent API Endpoint 是否需要 `[expose.api]`？

依赖：#18、#19
类型：讨论

### 问题

当 `mosoo deploy` 部署了一个 Agent 后，Agent API Endpoint 是默认输出，还是必须由用户在 `.mosoo.toml` 里声明 `[expose.api]`？

### 答案

已解决。

当前判断：默认输出。Agent deploy 后就应该有 Agent API Endpoint；访问控制通过 #24 定义的一次性可见 Agent API token 解决。`[expose.api]` 是多余分类，会把 Railway 式的“部署这个仓库”退回成“用户选择 surface 类型”。

## #21：Mosoo Deploy 是通用 repo deployer 吗？

依赖：#18
类型：讨论

### 问题

`mosoo deploy` 应该像 Railway / Nixpacks 一样尽可能让任何语言生态的仓库都部署成功，还是只部署刻意遵循 Mosoo Native Deployment Protocol 的仓库？

### 答案

已解决。

当前判断：只部署 Mosoo Native Deployable。Mosoo 不是通用 PaaS；它需要自己的 protocol 来描述一个仓库如何被 Mosoo 部署。不是任何 repo 都应该通过 Mosoo Deploy validator。当前 adoption 路径是 Codex、本地 coding agent、Mosoo Skill、Mosoo CLI；长期路径是 Mosoo 自己的 App Builder，把开发、上线、部署和持续构建收回 Mosoo 内部。

Railway 类比只保留两个启发：不要让用户选择硬业务类型；不要把 API / Web / Agent Builder 做成不同 console。Railway 类比不应该扩展成 “Mosoo 自动理解任意 repo”。Web build 检测可以作为 Mosoo Native 协议内部的 convenience，但缺少 Mosoo Native 文件时应该是 authoring error，而不是泛化部署失败。

ADR：见 [0003-use-mosoo-native-protocol-instead-of-generic-repo-detection.md](../adr/0003-use-mosoo-native-protocol-instead-of-generic-repo-detection.md)。

## #22：`mosoo deploy` 默认交互是什么？

依赖：#17、#18、#21
类型：讨论

### 问题

当用户或 coding agent 运行 `mosoo deploy` 时，默认应该直接写入线上资源，还是先展示 deployment preview 并要求确认？

### 答案

已解决。

采用直接写入模型：`mosoo deploy --dry-run` 用来查看 preview 和校验结果；`mosoo deploy` 执行 validate + deploy。缺 setup、target 不明确、会产生危险操作时，命令必须 fail-fast，并输出可修复动作；不能通过半自动 confirm 来掩盖不确定性。

原因：Mosoo Native 的首个采用路径是 coding agent / terminal workflow。`deploy` 的语义应该是上线，`--dry-run` 的语义才是预览。MVP 不引入 confirm / `--yes` 状态机；风险控制靠 validator、明确 target 和 fail-fast，而不是靠交互确认。

## #23：MVP 资源复用规则是什么？

依赖：#16、#18、#21、#22
类型：讨论

### 问题

用户重复运行 `mosoo deploy` 时，Mosoo 应该如何决定复用哪个 App / Agent / Deployment？能否按 name 自动猜测已有资源？

### 答案

已解决。

采用本地 project binding：当前 repo 绑定一个 Mosoo App，后续 deploy 只更新这个 App 内的资源。首次 deploy 如果没有绑定，可以创建新 App，或通过显式 `mosoo deploy --app <app-id>` / `mosoo link` 绑定已有 App。成功后本地 deploy state 记录 `orgId` / `appId`，类似 Vercel 的 `.vercel/project.json`。`.mosoo.toml` 仍然是可提交的 Mosoo Native protocol 文件；本地 deploy state 不进 protocol，不放 secrets。

禁止按 name 跨 App / workspace 猜测复用。绑定缺失、绑定 App 无权限、当前 repo 指向多个可能目标时，`mosoo deploy` 必须 fail-fast，并要求用户显式 link / target。原因：Mosoo 已经确定 no guess；name matching 对 coding-agent 生成的资源尤其危险。MVP 要继承 Vercel 的 local project binding 思路，以及 Mintlify 的 explicit project/spec 思路，而不是每次按名字猜。

## #24：Agent API Endpoint 是否自动创建 token？

依赖：#19、#20、#22、#23
类型：讨论

### 问题

`mosoo deploy` 输出 Agent API Endpoint 时，是否只展示 endpoint / OpenAPI，还是必须同时创建并展示 Access Token？

### 答案

已解决。

采用自动创建一次性可见 token：`mosoo deploy` 成功后输出 Agent API Endpoint、OpenAPI URL 和一个新创建的 Agent API token。token 只在当前 terminal 输出一次，用于让用户立即调用刚部署的 Agent。`mosoo deploy --dry-run` 不创建 token。

安全边界：token 不写入 `.mosoo.toml`、不写入 repo、本地 deploy state 不保存 token；输出必须明确标注 “visible once”。这是为了最快完成首次调用体验而接受的 MVP 取舍，已知代价是 secret 可能进入 terminal scrollback、shell transcript 或 coding-agent logs。后续可以补 `--no-token` / token 管理命令，但不是当前 MVP 决策前提。

## #25：`[expose.web]` 和 `[[agents]] expose = "public_thread"` 的关系是什么？

依赖：#19、#20、#23
类型：讨论

### 问题

Mosoo Native v1 里，Web 调用 Agent 的目标协议入口应该是新的 `[expose.web]`，还是保留当前 `.mosoo.toml schema = 1` 的 `[[agents]] expose = "public_thread"` 语法？

### 答案

已解决。

采用 `[expose.web]` 作为目标协议统一入口，`[[agents]] expose = "public_thread"` 被吸收为内部 binding 能力和当前实现锚点。用户写：

```toml
[expose.web]
agent = "support"
```

Mosoo 负责给 Web 注入调用同一 App 内 Agent 的能力。`[[agents]] expose = "public_thread"` 不进入 v1 目标语法；它只说明当前实现里已经有可以复用的 injected binding wedge。原因：目标协议不能暴露两套 expose 语言，否则 coding agent 会同时学习 `[expose.web]` 和 `[[agents]]`，心智会分裂。

## 附录：原始讨论碎片

以下内容来自原 `docs/product/agent-app-market-fragments.md`，保留为后续合并成单一中文 PRD 的原始材料。

Mosoo 现在讨论的对象，不能先从“首个用户是谁”开局。更准确的起点是：我们对某一类问题感兴趣，但现在仍有“拿着锤子找钉子”的状态。先把问题谱系画清楚，再判断哪个场景替换价值最高、差异化价值最大、能做到十倍好体验。

---

目前看起来有三个明确落地场景。

个人秘书叙事：用户想在自己的 Discord、Slack、Lark 等 Channel 里做有状态、人格化的 Personal Agent。这件事非常 tough，Mosoo 坚决不做。

数字员工叙事：Agent 作为一位“同事”进入企业 Channel。企业协作从人与人协作，变成 Agent 与人协作。用户会期待它人格化、有状态、有名字，并负责某个 Scope 内的工作。一个 Agent 可能对接 10 到 20 个真人。

集成叙事：Agent 作为自动化能力被集成到企业现有系统或应用中。过去这个位置可能是 n8n 或 Zapier。现在 LLM 有 thinking 和 tools，逻辑变成 “When something happens, then do something”。原来 SOP 节点里由人负责的部分，可以被 Agent 替换。

---

集成叙事下还有两个目标用户分叉。

开发者用户：他们想开发 Agent App 给目标用户使用，常见于 SMB 或创业公司。他们会在代码仓库里写大量 Integration Agent 生命周期管理，本质上是各种 Agent SDK 的用户。

业务导向用户：他们不关心生产实践或代码细节，只想拿到业务效果。他们甚至不想考虑部署，只想得到最终 Project 来服务用户。

---

这些场景更像一个光谱。接下来要找的是：他们现在解决这个问题的路径够不够丝滑；哪个替换价值最高；哪个差异化价值最大；哪个能做到十倍好体验。

如果问题已经被解决得很好，或者替代方案已经非常拥挤，就不应该做。

---

开发者用户和业务导向用户的差别，不只是懂不懂代码，而是他们购买的东西不同。

第一类用户会自己拼装组件来实现业务目标。Mosoo 对他们来说只是其中一块拼图，价值在于节省一部分力气。这块拼图必须比市面上可选的其他拼图更顺手，否则他们会自己写、换 SDK、或者直接粘现有 infra。他们是非常挑剔的用户。

业务导向用户在产生想法时，甚至处于完全从零到一的阶段。项目还没启动，代码仓库还没有。他们不想买一块拼图，而是想拿到一个能服务目标用户的 Project。

---

这个讨论可以严格拆成几类：用户在解决什么问题；Mosoo 能提供什么 service；他们现在用什么方法解决这个问题。

不能只问“用户是谁”，也不能只问“我们有什么锤子”。要把问题、service、现有替代路径三者放在同一张表里复盘：如果现有路径已经足够丝滑，Mosoo 不该做；如果现有路径拥挤但用户切换收益不大，Mosoo 也不该做。

---

个人秘书叙事的接近对标是“龙虾”（OpenClaw），而且各个厂商应该都会朝 Jarvis 方向走。Mosoo 不应该进入这个消费级 Personal Agent / Jarvis 方向。

---

数字员工领域也很拥挤，但要拆成两类。

消费级数字员工：用户在某个新的入口里搭建和使用。这类产品重消费、轻构建，Mosoo 不碰。

重构建、轻消费的数字员工：帮助人们构建数字员工，并完成 distribution。Claude Managed Agents 属于这一类。这是 Mosoo 应该着重讨论的窗口。

这些数字员工都是有状态、人格化的。企业内部除了构建这类有状态的数字员工，还需要构建一些无状态自动化集成。

---

在无状态自动化集成上，用户可能使用 AI SDK、Mastra SDK 或现成 Agent Framework。但这本质是在玩拼图。只帮开发者节省开发成本、做框架，不是好生意。

Integration 可以讨论，但要警惕 Mosoo 只变成某个仓库、某个应用里的一角拼图。

---

谁会使用这类产品，有两个叙事逻辑。

面向企业开发者的集成叙事：帮助企业里的开发者完成某种集成，类似 Claude Managed Agents。它是一种 distribution，服务于企业内部某种流程。价值点是帮企业构建数字员工，或者帮开发者节省时间。商业化路径不太好走，但可以卖给老板：老板买“智能化趋势”，使用者真实获得感是“节省时间”。

面向 SMB 或创业公司的交付叙事：他们不像企业内部的一员，可能没那么关心代码实现、部署或架构，只关心把东西做出来拿去用。他们最接近“交付一个结果”的群体。这个赛道非常拥挤，包括 v0、Lovable、Base44、Replicate、Bolt.new 等。现有缺陷是：这些产品构建 General 应用时，倾向于通过一个聊天框让用户直接面向生产应用进行 Web Coding，完成开发并部署上线。

另一路径是开发者自己用 Codex 构建应用，再部署到 Cloudflare；或者用 Modal CLI、Vercel 完成部署。

---

这里有机会，但必须准确描述。

Mosoo 不适合成为 Coding Agent 时代数字员工领域的 Vercel。Vercel 核心管部署；如果专注部署，应该专注做异构部署。但 Mosoo 当前技术环境绑定在 Cloudflare 上，不是异构部署。

---

第一个机会是迁移交互体验与用户心智。

应用赛道虽然拥挤，但可以把类似的交互体验、已被教育过的用户心智和用户旅程搬到 Agent App 这里。Mosoo 不一定非要“做员工”，也可能仍然是在“做应用”，或者更准确地说，做一种能容纳有状态员工和无状态自动化的 Agent App。

但如果只是 General 应用部署，用户直接用 Codex 或 Claude Code 加 Cloudflare CLI 就能完成。Mosoo 会变成额外中间商，商业逻辑上这种价值不应该存在。

因此必须从 General 应用中切出特定领域，例如某种 Agent 应用，明确这类应用的特征，并确认它未来会成为趋势。只有这样，Mosoo 才可能比竞品更好，也比用户直接用 Codex 加 Cloudflare CLI 更有优势。

---

第二个机会是定位为构建与托管服务，而不是单纯部署。

无论用户要做有状态 Agent 还是无状态 Agent，Mosoo 某种程度上提供的都是构建与托管服务。

这里有一个关键差别：第一种情况交付完整应用；第二种情况交付应用的一部分。第二种情况下，Mosoo 负责把这块“拼图”产生出来，用户拿它去拼成什么、具体做什么，Mosoo 并不关心。

“Agent App” 这个说法的好处是，它不强迫 Mosoo 只做人格化员工，也不把 Mosoo 降格成无状态集成拼图。它可以容纳两种形态：有状态数字员工和无状态自动化。

---

作为产品经理和产品团队，Mosoo 有责任、有义务向用户回答：这个产品到底解决什么问题。

不能让用户自己猜产品怎么用。产品必须教育用户什么是正确打开方式。这个表达可以是 JTBD，也可以是电梯演讲。

---

Railway 不严格区分应用业务类型。对 Railway 来说，核心抽象是 Project 下面的 Service；一个 Service 是一份代码或镜像、一条启动命令、一组环境变量、一个运行环境。它是 Web、API、Bot、Worker 还是 Cron，主要由运行方式决定：是否监听 `PORT`、是否常驻、是否按计划执行、是否是数据库镜像等。

这解释了 Railway 为什么学习成本低：用户不用先回答“我在部署什么业务应用”，只要回答“这个进程怎么运行”。Next.js、FastAPI、Django 等官方支持更多是 build/start 推断，不是不同产品类型。

迁移到 Mosoo 的启发：`Agent App` 可以作为总名词，但不能继续拆成一堆硬业务类型。Digital Employee、Automation、API Agent、Channel Agent 更适合作为模板、运行模式、exposure 或 distribution，而不是 `app.type`。

但 Mosoo 也不能照搬 Railway 的 generic Service。Mosoo 的机会不在“任何进程都能跑”，而在“Agent runtime 相关生命周期被产品化”：state、tools、credentials、channel/API exposure、logs、cost、replay、permissions、run history。

---

现在可以把机会按背后的代码形态拆成五类。

第一类是构建有状态的 Agent。无论具体用途是什么，它背后一定是一堆特定类型的代码。如果有状态 Agent 带有 Channel，代码里还会多一些 Channel Adapter。

第二类是构建无状态的 Agent。这种 Agent 专门处理某一种问题，类似部署 API 应用。虽然对外暴露为 API，但背后依然是某种特定类型的代码。

第三类是开发含前后端的应用。它背后是另一种类型的代码。

第四类是走向类似 Lovable 或 Bolt.new 的模式：使用某种 Coding Agent，让用户在聊天框里用自由文本表达，最终交付完整内容，并完成托管部署。

第五类是打造 PaaS 平台。这个模式下代码怎么产生不重要，核心在托管和运维服务。

这五类不能混成一个产品。它们对应的用户心智、代码生成方式、托管责任、商业化逻辑都不同。

进一步拆，第一类、第二类、第三类本身表达了需求，或者表达了某种用户意图：用户要有状态 Agent、无状态 Agent/API、或者含前后端的应用。第四类和第五类不是需求本身，而是产品决策或产品形态：走 Lovable/Bolt 式完整交付，或者走 PaaS 式托管运维。

Railway 的核心设计之一是它不真正理解应用是什么业务类型。它识别的是如何启动程序：怎么 build，怎么 start，要不要暴露端口。Next.js、FastAPI、Express、Discord Bot、MCP Server、LangGraph、Go API，对 Railway 来说都落在 Project / Service 这个运行抽象里。它检测语言和生态，生成 build plan，然后 build、run；它不检测“AI App”“博客”“Bot”这些业务类型。

这里出现两种路径。第一种是在这套思路里特化某种 Agent App：Mosoo 未来也不区分背后的项目到底是 API、Agent 还是 agent builder，而是围绕 Agent App 的运行、触发、分发和生命周期做产品化。第二种是走向另一个极端，仍然围绕语言和生态本身做构建和托管，Agent 应用只是其中一个子集。

---

真正的分岔不是“特化 vs 通用”，而是把 narrow waist 选在哪一层。

Railway 能做到类型全盲，不是因为它聪明地拒绝分类，而是因为它坐在 process 这根已经标准化很久的窄腰上。语言生态在腰上方，build plan 探测语言和包管理；行为模式在腰下方，监听 `PORT` 就是 Web，常驻就是 Worker，按计划执行就是 Cron。腰不需要知道上面是博客、Bot、API 还是电商。

Mosoo 对应的腰不是 process，而是 session / 委托。Railway 问 process：怎么 build、怎么 start、要不要暴露端口。Mosoo 应该问 session：怎么装备、怎么受理一次委托、委托从哪里来且结果送到哪里去。

Railway 的 Nixpacks / Railpack 探测语言；Mosoo 的 driver 探测并适配 runtime。Environment、packages、skills、MCP、凭证把 sandbox 装备起来；Driver 适配 Claude Code、Codex、OpenClaw、Hermes 等 runtime；API token、channel binding、trigger、仓库预览面决定委托入口和结果分发。

所以判断是：选“特化 Agent App 生命周期”，但用 Railway 式机制实现它。Mosoo 在 session 腰之上也应该全盲：不区分背后项目是 API、agent 还是 agent builder。凡是能回答怎么装备、怎么受理委托、结果送到哪里，就是一个 Agent App。差异通过 runtime、trigger、exposure、distribution、templates、resource bindings 表达，而不是让用户选择应用类型并进入不同 console。

不选 process / generic hosting 腰有三个原因。第一，process 腰已经 commodity，Railway、Render、Fly、Vercel 都在卷，而且 Mosoo 还被 Cloudflare 绑定。第二，generic build-and-run 只是帮开发者省时间，这不是好生意。第三，平台只能运营它的腰看得见的东西；process 腰看得见重启、扩容、端口路由，看不见一次委托失败后如何带上下文重试、员工记忆如何增长、单次运行花了多少钱、人工如何验收。

这个选择也有证伪器：如果 agent 负载最终收敛成普通长驻进程，session 语义被框架吸进应用代码里，平台只需要跑 process，那么 session 腰会蒸发，generic hosting 默认获胜。Dogfood / teardown 里如果用户只说“帮我跑代码”，而对过程记录、期限、按单成本、人工验收、重试和上下文无感，就说明选错了腰。

一句话：Nixpacks / Railpack 探测语言，Driver 探测 runtime；Railway 把腰选在进程上，Mosoo 把腰选在委托上。腰上方全盲，腰下方全深。

---

Mosoo Native 不是“猜 repo 里有什么”，而是让 coding agent 写出一个可验证的承诺：这个 Agent 怎么装备，委托从哪里进来，结果往哪里出去。协议的价值不是 TOML 本身，而是 Mosoo 能把这个承诺变成 Agent、Channel binding、API endpoint 或 Web deployment。

---

`.agent/` 应该像可搬走的 Agent 定义，`.mosoo.toml` 应该像留在这个 repo 的暴露计划。前者回答“这个 Agent 是谁、会什么、需要什么装备”；后者回答“在 Mosoo 上开什么面、怎么 host、部署后还缺哪些凭证”。Secrets 不属于任何一个文件。

---

更准确地说，`.agent/` 不应该被理解成“只能有一个 Agent”。它应该是 Agent definition set：一个 default / primary Agent 是最简单情况，一组 named Agents 是同一个 Agent App 变复杂后的自然形态。`.mosoo.toml` 不定义这些 Agent 是谁，它只回答每个 exposure 要打到哪个 Agent。

---

用户-facing 语言应该是 deploy，不是 apply/up。`mosoo deploy` 解决的问题很直接：当 coding agent 已经写好 Mosoo Native 文件时，CLI 需要一个 canonical command 去读这些文件、验证、输出部署预览、报可修复错误，并把这个仓库部署到 Mosoo 线上。Web / Lens 可以展示同一份部署预览、setup requirements 和结果，但不能替代 agent 可运行的 CLI feedback loop。

三人团队一个月首发时，目标协议不能等于 MVP 范围。MVP 应该像一年级作文：`mosoo deploy`、dry-run validator、Agent API Endpoint default output、Web。多 Agent 不应该被砍掉，因为当前 App 已经能支持多个 Agents；Channel Binding 才是应该先排除的那条。复杂资源复用、稳定部署预览 schema 都是后续演化，不是首发门票。

Agent API Endpoint 不应该要求 `[expose.api]`。用户 deploy 的是仓库和 Agent；API endpoint 是 Agent 被部署后的默认结果，访问用 token / PAT 解决。否则我们会重新发明“让用户选择这是 API 还是 Web”的分类问题，背离 Railway 给我们的启发。

---

Mosoo Deploy 不是“任何仓库都可以试着部署”的通用工具。它部署的是 Mosoo Native Deployable：一个被 Codex、本地 coding agent、Mosoo Skill 或未来 App Builder 按 Mosoo protocol 写出来的仓库。Railway / Nixpacks 的启发只在于不要问用户硬业务类型；不代表 Mosoo 要做任意 repo 自动检测。短期我们寄生在 Codex 和本地 coding agent 上，让它们学会写 Mosoo Native 文件；长期应该由 Mosoo 自己的 App Builder 承担开发、上线、部署、持续构建的全生命周期。
