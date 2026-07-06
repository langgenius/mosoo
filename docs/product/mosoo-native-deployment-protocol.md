# Mosoo Native Deployment Protocol v1 草案

状态：产品 spec 草案，记录目标协议。`[expose.channel]`、`[expose.web]`、`mosoo deploy`、Native dry-run validator 还不是当前实现。Agent API Endpoint / Public Thread API 已有当前实现，但 Native deploy wiring 仍是目标。

## 一句话

Mosoo Native Deployment Protocol 是 coding agent 和未来 Mosoo App Builder 写给 Mosoo 的 deployable contract。repo 必须被刻意写成 Mosoo Native Deployable；Mosoo 验证这些标准文件，并把它们转换成 Agent、App-local resources、Agent Exposure 和 App Deployment。

Mosoo 不要求用户先选择硬应用类型，也不把 repo 猜测当作协议。协议的窄腰是 Agent/session/delegation：Agent 如何被装备，一次委托如何被受理，请求从哪里来，结果送到哪里去。

这不是 Railway / Nixpacks 式的“任意仓库检测并部署”。当前采用路径是寄生在 Codex、本地 coding agent、Mosoo Skill 和 Mosoo CLI 上，让 coding agent 学会写 Mosoo Native 文件；长期路径是 Mosoo 自己的 App Builder 承担从开发、上线到持续构建的完整 authoring surface。

## 目标

1. 给 coding agent 一个可学习的 repo 文件协议，而不是让 Mosoo 猜测 repo 意图。
2. 先让一个 repo 可以通过 CLI 部署到 Mosoo；MVP 默认给 deployed Agents 输出 Agent API Endpoint，并支持 Web/Worker deployment；Channel delivery 暂不进入当前范围。
3. 保持 SPEC 约束：App 是产品边界，Agent owns runtime/delivery，V1 不引入 generic Service entity，也不使用 `app.type` 驱动 runtime/access/ownership。
4. 明确 secrets 红线：deployable files 不携带 plaintext secret，只携带 reference 或 post-deploy setup requirement。
5. 把 Mosoo Native 设计成 Mosoo 自有 App Builder 的未来输出格式，而不把短期 Codex / local coding-agent workflow 当成长期产品边界。

## 非目标

- 不把 Mosoo 做成 generic process hosting。
- 不把 `mosoo deploy` 做成 Railway / Nixpacks 式任意 repo detector。
- 不引入 `Service` 领域实体、`services` table、polymorphic `service.kind`。
- 不把 Agent API Endpoint 命名成 Agent Service。
- 不把 `.agent/` 解释成只能声明一个 Agent；单 Agent 只是默认简写。
- 不把 `.agent` package 直接扩大成完整 App package。
- 不把 alpha 阶段已有 manifest 字段形态 / `.mosoo.toml schema = 1` 当成长期兼容约束；目标协议可以直接采用最新形态。
- 不把用户-facing CLI 主命令命名成 `mosoo up`；产品语义是 deploy 一个仓库到 Mosoo。
- 不把 Channel Binding、所有外部 Channel credential / OAuth setup、复杂资源复用策略放进一个月 MVP 的必做范围。

## One-Month MVP Cut

首个 MVP 优先证明一件事：coding agent 通过 Mosoo Skill / CLI 写好 Mosoo Native 文件后，用户能在 terminal 里运行 `mosoo deploy`，把这个 Mosoo Native repo 部署到 Mosoo 线上。

MVP 保留：

1. 一个或多个 Agents：root `.agent/manifest.json` 是 primary Agent 简写；需要多 Agent 时使用 named Agent definitions。
2. 一个必需 root `.mosoo.toml`：用 `spec = "mosoo.spec.v1"` 声明 Mosoo Native repo，并承载需要的 deployment / exposure config。
3. `mosoo deploy --dry-run`：只校验文件，输出部署预览，不写入。
4. `mosoo deploy`：执行部署，输出 Agent API endpoint / OpenAPI URL、线上 Web URL、setup requirement。
5. Secrets 红线：文件里不写 plaintext secret。

MVP 暂不做：

- Channel Binding / `[expose.channel]`。
- 自动创建所有外部 Channel credential / OAuth setup。
- 复杂资源复用和 drift detection。
- 把部署预览做成长期稳定 API schema。

实现依据：当前代码已有 Public Thread API / OpenAPI / PAT 路径，也已有 AppDeployment / AppDeploymentRun、`.mosoo.toml schema = 1` AppDeployment override 和 `deployApp` GraphQL operation。App 已经可以拥有多个 Agents。Channel Binding 暂不作为当前 deploy scope。

## 协议版本

目标公开 spec identifier：`mosoo.spec.v1`。

每个 Mosoo Native repo 必须在根目录提供 `.mosoo.toml`，并在顶层声明：

```toml
spec = "mosoo.spec.v1"
```

Agent-only repo 也需要这个最小 `.mosoo.toml`。它不是 Web config 负担，而是 Mosoo Deploy 判断“这是一个刻意写给 Mosoo 部署的 repo”的入口声明。

当前实现事实：现有 `apps/api/src/modules/apps/application/app-deployment-detector.ts` 只接受 `.mosoo.toml schema = 1` 或省略 schema，并把 `.mosoo.toml` 当 AppDeployment override。这是 alpha 现状，不是兼容包袱。目标协议可以直接采用 `spec = "mosoo.spec.v1"`；在实现前，不应把 `mosoo.spec.v1` 示例当成当前可执行 TOML。

## Repo 表面积

目标 Mosoo Native repo：

```text
my-repo/
├── .agent/
│   ├── manifest.json                 # default / primary Agent shorthand, including behavior instructions
│   ├── agents/                        # optional named Agent definitions
│   │   └── <agent-name>/
│   │       └── manifest.json
│   ├── skills/
│   ├── .mcp.json
│   └── environment/definition.json
├── .mosoo.toml
└── src/
```

边界：

| Surface       | 负责什么                                                                                                                                                | 不负责什么                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `.agent/`     | 可复用 Agent definition set：一个 primary Agent 或多个 named Agents，以及行为、runtime intent、Skills、MCP、Environment requirements                    | repo-local exposure、host build/deploy、plaintext secrets   |
| `.mosoo.toml` | Mosoo Native repo marker 和 repo-local deployment exposure：Web surface、target Agent binding、binding names、build/deploy overrides、host-layer config | Agent identity、Agent capability package、plaintext secrets |
| `src/`        | 完整 Web app、Worker、API glue 或其他普通代码                                                                                                           | 必填 Agent definition set                                   |

注意：现有 `.agent` package contract 是单 Agent portable package，已使用 `manifest.json`、`skills/`、`.mcp.json`、`environment/definition.json`。Native repo source surface 可以在它之上引入 Agent definition set；`.agent/agents/<name>/` 是目标 repo source surface 草案。v1 直接把 Agent behavior instructions 放在对应的 `manifest.json` 里，不单独引入 `instructions.md` 文件。

## `.agent/` Agent Definition Set

`.agent/` 描述“这些 Agent 是谁、会什么、需要什么装备”。

单 Agent repo 可以使用 root-level shorthand：

| 文件                                 | 目标语义                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `.agent/manifest.json`               | default / primary Agent 的 identity、kind、runtime、model、behavior instructions、manifest/version metadata |
| `.agent/skills/`                     | 可复用 Skill package，沿用 agentskills.io 风格目录                                                          |
| `.agent/.mcp.json`                   | MCP server intent；不得包含 plaintext credential                                                            |
| `.agent/environment/definition.json` | packages、setup script、network policy、allowed hosts 等 Environment template；不得包含 secret values       |

多 Agent repo 是当前目标范围。具体目录布局仍是 open decision；当前候选形态是 `.agent/agents/<agent-name>/manifest.json`，每个 named Agent 的 behavior instructions 也在自己的 manifest 里。共享 Skills、MCP 和 Environment 可以留在 `.agent/` root，由各 Agent manifest 引用。

`.agent/` 必须保持 portable。导入到另一个 App、另一个 Mosoo instance 或另一个 owner 时，每个 Agent 的 runtime/model/MCP/Environment/credentials 都要在目标 App context 内重新 resolve。

## `.mosoo.toml` Deployment Exposure

`.mosoo.toml` 描述“这个 repo 是 Mosoo Native Deployable，以及它在 Mosoo 上开什么面”。

最小 Agent-only repo：

```toml
# Target protocol example only. Existing schema = 1 parser does not accept this yet.
spec = "mosoo.spec.v1"
```

目标形态示例：

```toml
# Target protocol example only. Existing schema = 1 parser does not accept this yet.
spec = "mosoo.spec.v1"

[agent]
path = ".agent"

[expose.channel]
agent = "support"
provider = "lark"

[expose.web]
agent = "support"
build = "npm run build"
```

规则：

- Agent API Endpoint 是 Agent deploy 的默认输出，不需要在 `.mosoo.toml` 里声明 `[expose.api]`。
- `.mosoo.toml` 必须存在，且必须声明 `spec = "mosoo.spec.v1"`。
- 当前 MVP 的 explicit expose surface 只有 `web`。
- `[expose.channel]` 是目标协议 surface，但不进入当前 MVP。
- Agent-only repo 可以只声明 `spec`，不声明 Web；包含 Web/Worker code 时继续在 `.mosoo.toml` 配置 Web deploy / binding。
- 如果 `.agent/` 只有一个 Agent，`agent` target 可以省略并默认指向 primary Agent。
- 如果 `.agent/` 有多个 named Agents，Web binding 必须显式声明 target Agent。
- Build/deploy overrides 属于 `.mosoo.toml`，不进入 `.agent/manifest.json`。
- Credential values 不进入 `.mosoo.toml`；只能声明 credential reference、provider、setup mode 或 post-deploy repair requirement。

## Expose Surfaces

### `[expose.channel]` -> AgentChannelBinding

用户意图：把一个 Agent 绑定到外部 Channel，使外部 thread/message 可以触发 Agent 并收到回复。

目标 TOML：

```toml
[expose.channel]
agent = "support"
provider = "lark"
```

Mosoo 目标行为：

1. 创建或复用 target Agent。
2. 创建或复用 App-scoped Channel setup。
3. 创建 AgentChannelBinding。
4. 输出 credential/setup requirement，例如 OAuth、扫码、bot token 或 webhook secret。
5. 输出 Channel binding 状态。

实现状态：Channel Binding 不进入当前 MVP；本节保留为目标协议 surface，不阻塞 `mosoo deploy`。

### Agent API Endpoint -> Default Agent Deploy Output

用户意图：让外部程序通过 HTTPS / OpenAPI 调用一个 Agent，并获得 Thread 语义。

Mosoo 目标行为：

1. 每个 deployed Agent 默认有 Agent API Endpoint。
2. 输出 Public Thread API endpoint 和 OpenAPI URL。
3. 自动创建一次性可见 Agent API token，并在 terminal 只显示一次。
4. 不要求用户在 `.mosoo.toml` 中声明 `[expose.api]`。

实现锚点：Public Thread API、OpenAPI contract、PAT 路径已存在。缺口是 Native deploy 后的 CLI 输出格式和 token creation wiring。

### `[expose.web]` -> AppDeployment / AppDeploymentRun

用户意图：部署完整 Web/Worker 应用，必要时让这个应用调用同一 App 内的 Agent。

目标 TOML：

```toml
[expose.web]
agent = "support"
build = "npm run build"
```

Mosoo 目标行为：

1. 读取 repo build/deploy config。
2. 创建或复用 AppDeployment。
3. 创建 AppDeploymentRun，构建并提交到目标 host。
4. 当 `[expose.web] agent = "<name>"` 存在时，给 Web 注入调用同一 App 内目标 Agent 的 capability。
5. 输出 preview/production URL 和 DeploymentRun 状态。

目标协议关系：`[expose.web]` 是 v1 统一入口；`[[agents]] expose = "public_thread"` 不进入目标语法，只作为当前实现里的 injected binding wedge 和迁移锚点。缺口是把这条能力吸收到 Mosoo Native `[expose.web] agent = "<name>"` 语义里。

## Mosoo Deploy / Validate Action

`mosoo deploy` 是目标 CLI 动作：把当前仓库按 Mosoo Native 文件部署到线上。它不是任意 repo 的 best-effort deploy；缺少 Mosoo Native 文件时应该失败并告诉 coding agent 需要创建哪些协议文件。Lens / Web Console 可以展示同一份部署预览、setup requirements 和结果，不应成为 coding agent 修复文件的唯一入口。当前 Go connector/CLI 证据里有 generated Console/Public API commands、root shortcuts、`mosoo agent manifest apply --dry-run`、`deployApp`，但还没有已定义的 Native `mosoo deploy`。

默认交互：

- `mosoo deploy --dry-run`：只 validate 并展示 deployment preview，不创建或更新资源。
- `mosoo deploy`：执行 validate + deploy，默认直接写入。
- 如果缺少 blocking setup、target 不明确或会产生危险操作，`mosoo deploy` 必须 fail-fast，并输出可修复动作。
- MVP 不引入默认 confirm，也不要求 `--yes` 才能写入；风险控制靠 validator 和明确 target，不靠交互确认。

资源复用：

- 当前 repo 通过本地 deploy state 绑定一个 Mosoo App，后续 deploy 只更新该 App 内资源。
- 首次 deploy 没有绑定时，可以创建新 App，或通过显式 `mosoo deploy --app <app-id>` / `mosoo link` 绑定已有 App。
- 本地 deploy state 记录 `orgId` / `appId`，不进入 Mosoo Native protocol，不提交 secrets。
- 禁止按 name 跨 App / workspace 猜测复用；绑定缺失、无权限或目标不明确时 fail-fast。

Mosoo Deploy 目标行为：

1. 读取 `.agent/`，解析 Agent definition set。
2. 读取 `.mosoo.toml`，解析 deployment exposure。
3. 读取本地 deploy state 或显式 `--app` target，确定唯一目标 App；目标不明确时停止。
4. 运行 validator；遇到 blocking setup、ambiguous target、dangerous operation 或 schema error 时停止。
5. 创建或更新目标 App 内的一个或多个 App-local Agents 和 App-local resources。
6. 为 deployed Agents 创建一次性可见 Agent API token，并输出 Agent API Endpoint / OpenAPI URL / token。
7. 对 `[expose.web]` 创建 AppDeployment / DeploymentRun。
8. 输出 facts：endpoint、OpenAPI URL、deployment URL、DeploymentRun 状态、non-blocking setup reminders。

Agent API token 输出规则：

- `mosoo deploy` 成功后自动创建 token，并在 terminal 只展示一次。
- `mosoo deploy --dry-run` 不创建 token，只展示将输出 Agent API Endpoint / OpenAPI 的 preview。
- Token 不写入 `.mosoo.toml`、repo 文件或本地 deploy state。
- 输出必须明确标注 token 是 secret 且 only visible once；MVP 接受 terminal / log 暴露风险，换取首次调用路径最短。

## Validator Contract

验证器是协议 adoption loop 的核心。规范的直接采用者是 coding agent；清晰错误就是反馈循环。MVP 只承诺人类可读文本输出，不提供 `--json`，也不承诺稳定的 machine-readable deployment plan schema；只需要 coding agent 能读懂并修复。验证器可以在 Mosoo Native 协议内部做辅助检测，但不能把任意 repo 猜成 Mosoo app；缺协议文件是明确的 authoring error。

错误要求：

- 指向具体文件和字段。
- 明确当前值为什么非法。
- 给出可修复动作。
- 区分 `error`、`warning`、`setup_required`。
- 不把缺 credential 误报成 schema error。
- `mosoo deploy --dry-run` 可以报告 setup_required；`mosoo deploy` 对 blocking setup_required 必须停止写入。
- dry-run 输出可读部署预览，而不是长期承诺的机器协议。
- MVP 不提供 `--json` 输出；未来需要 CI/automation 时再定义独立结构化契约。

示例：

```text
.agent/manifest.json: runtime is required.
.agent/.mcp.json: server "github" must not include plaintext token.
.agent/environment/definition.json: networkPolicy.allowedHosts must be an array of hostnames.
.mosoo.toml: spec must be "mosoo.spec.v1".
.mosoo.toml [expose.web]: agent "support" is not defined in .agent/.
.mosoo.toml [expose.channel]: channel exposure is not supported in the current MVP.
setup_required github: connect GitHub token after deploy.
```

## Coding Agent Instruction

一页 instruction 草案：

```markdown
To make this project deployable on Mosoo, produce Mosoo Native files.
Mosoo deploys repositories that intentionally follow the Mosoo Native Deployment Protocol; do not rely on generic framework detection.

Create `.agent/manifest.json` to describe the primary Agent: identity, runtime, model, kind, and behavior instructions.
If the project needs multiple Agents, create named Agent definitions and point each expose surface at the correct Agent.
Put reusable skills under `.agent/skills/`.
Put MCP server definitions in `.agent/.mcp.json`; never write secrets.
Put environment packages, setup, and network policy in `.agent/environment/definition.json`.
Create root `.mosoo.toml` with `spec = "mosoo.spec.v1"`. Add Web deploy configuration or Web-to-Agent binding there only when needed. Do not declare `[expose.api]`; Agent API Endpoint is a default deploy output. Do not create Channel exposure in the current MVP.

Run `mosoo deploy --dry-run` before finishing. Fix every reported file and field error.
```

## 当前实现映射

| 能力                                             | 当前状态                                                                                | 证据锚点                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Agent Manifest / `.agent` package                | 已有单 Agent package contract，不等于 multi-Agent repo source protocol 已完整产品化     | `pkgs/contracts/src/agent/*`、`pkgs/agent-package/src/*`           |
| `environment/definition.json`                    | 已有 package sidecar/ref 约束                                                           | `pkgs/agent-package/src/archive-environment-sidecar.ts`            |
| `.mcp.json`                                      | 已有 package sidecar/ref 约束                                                           | `pkgs/agent-package/src/archive-mcp-sidecar.ts`                    |
| AgentChannelBinding                              | 有底层服务痕迹，但不进入当前 MVP                                                        | `apps/api/src/modules/channels/*`                                  |
| Agent API Endpoint / Public Thread API / OpenAPI | 已有 public API contract                                                                | `pkgs/contracts/src/http/*`、`apps/api/src/modules/public-api/*`   |
| AppDeployment / AppDeploymentRun                 | 已有 deployment resource/run                                                            | `apps/api/src/modules/apps/application/app-deployment*.ts`         |
| `.mosoo.toml schema = 1`                         | 已有 AppDeployment override，只支持 `schema/type/build/deploy/worker/routes/[[agents]]` | `apps/api/src/modules/apps/application/app-deployment-detector.ts` |
| `[expose.channel/web]`                           | 目标协议，未实现                                                                        | 本 spec                                                            |
| `mosoo deploy` / dry-run validator               | 目标 CLI deploy workflow，未实现                                                        | 本 spec                                                            |

## 当前结论

Mosoo Native 的核心不是让用户选择应用类型，也不是让 Mosoo 猜测任意 repo，而是让 coding agent 或未来 App Builder 写出可验证的 Agent App deployable contract。

Railway 的协议围绕 process：build、start、port。Mosoo 的协议围绕 delegation：装备 Agent、受理委托、暴露入口、分发结果、记录过程。Railway 类比只保留“不要让用户选择硬业务类型”，不保留“任意仓库自动检测”。

最小产品句子：

> Mosoo lets coding agents produce deployable Agent Apps by following a native file protocol, then turns those files into deployed Agents with API endpoints and, when needed, hosted Web deployments or future Channel bindings.
