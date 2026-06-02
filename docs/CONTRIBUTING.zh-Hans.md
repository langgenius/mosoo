# Mosoo 贡献指南

Language: [English](./CONTRIBUTING.md)

Mosoo 仍处于 alpha 探索期，仓库会快速迭代。本文档只描述当前仓库真实可用的开发与贡献流程，避免继承已经过时的旧说明。

## 开始之前

改动代码前，先阅读相关产品与架构文档：

- PRD 索引：[dev/prd/README.md](../dev/prd/README.md)
- 架构设计：[dev/architecture.md](../dev/architecture.md)

这些文档用于确认系统边界、模块关系和设计意图。如果 PRD、架构和实现不一致，优先修正源头，不要在生成文件、局部 adapter 或临时分支里掩盖问题。

## 仓库结构

当前仓库是 monorepo：

| 路径             | 说明                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/api`       | Cloudflare Worker API，包含 GraphQL、认证、会话、channel、runtime control plane、D1/R2/DO bindings。 |
| `apps/web`       | React Web 应用，使用 Vite Plus 构建，并以 Cloudflare Worker assets 方式部署。                        |
| `apps/driver`    | Agent runtime driver bundle，供 API Worker / Sandbox 路径使用。                                      |
| `pkgs/contracts` | 跨边界 TypeScript contracts 和 parser surface；跨 app / package 的 DTO 优先放这里。                  |
| `pkgs/db`        | Drizzle schema 和当前生成的 baseline migration。                                                     |
| `pkgs/*`         | runtime-neutral 共享包，覆盖事件、策略、包格式、观测、开发认证和 effect 等能力。                     |
| `e2e`            | Playwright 本地验收脚本和 runtime signal contract 检查。                                             |
| `dev/prd`        | 产品契约和写作规范。                                                                                 |

以下是生成文件，禁止手改：

- `apps/api/src/adapters/graphql/schema.generated.graphql`
- `apps/web/src/gql/**`
- `pkgs/db/drizzle/**`

如果生成结果不符合预期，回到它们对应的 schema、contract、resolver 或 PRD 源头修正。

## 工具链

必需工具：

- `bun >= 1.3.14`
- `just >= 1.51`
- Vite Plus 的 `vp`：`curl -fsSL https://vite.plus | bash`

仓库内已经锁定 Vite Plus 和 Git hook 工具依赖。日常命令入口统一使用全局 `vp`；脚本内部需要稳定入口时使用仓库内的 `node_modules/.bin/vp`。

命令约定：

- 任务调度使用 `vp run ...`
- 本地工具使用 `vp exec ...`
- 需要 Bun runtime 时使用 `vp exec bun ...`
- 直接 `bun install` 只用于依赖安装前的 bootstrap
- `bun install` 后使用 `vp exec prek -c dev/config/prek.toml install` 安装 Git hooks，确保 hook installer 来自仓库依赖图，而不是一次性的 `dlx` 执行。

## 初始化

在仓库根目录执行：

```bash
bun install
vp run env:init
vp exec prek -c dev/config/prek.toml install
vp run db:migrate:local
```

`vp run env:init` 会创建或补齐 `apps/api/.dev.vars`：

- `VAULT_ROOT_SECRET`、`BETTER_AUTH_SECRET`、`RUNTIME_ACTION_TOKEN_SECRET` 会自动生成本地随机值。
- 已有真实值不会被覆盖；如果文件里仍是 `apps/api/.dev.vars.example` 的占位值，脚本会替换成随机值。
- `GOOGLE_OAUTH_CLIENT_ID` 和 `GOOGLE_OAUTH_CLIENT_SECRET` 仅在测试 Google 登录时需要，可在脚本生成后手动填写。
- R2 / Cloudflare account 相关变量只在远程存储路径或接近生产的 Cloudflare 资源路径中需要，可按需手动填写。

本地 OTP 邮件由 Wrangler dev 下的 Cloudflare Email Workers 行为输出为本地 `.eml` 文件。生产邮件需要配置 Cloudflare Email Routing 和 `AUTH_EMAIL_FROM`。

## 本地开发

启动常规本地栈：

```bash
just dev
```

这个命令会先执行本地 D1 migration，然后启动 driver build、API Worker 和 Web 应用。

默认本地地址：

- Web：`http://localhost:5173`
- API：`http://localhost:8787`

本地登录：

- 普通邮箱登录走 OTP。
- loopback origin 下，输入 `@mosoo.ai` 后缀邮箱会使用本地开发登录通道，跳过 OTP。

本地开发注意事项：

- D1 migration 不会在首次请求时自动应用；启动服务前先执行 `vp run db:migrate:local` 或 `vp run db:regen`。
- Preview MCP 开发服务使用 `5180+` 端口；`5173` 和 `5174` 已保留给本地 Web / dev flow。
- 断言端口占用或性能问题前，先用 `lsof`、`curl`、计时或可复现命令实测。

## 常用命令

```bash
vp run env:init          # 创建或补齐 apps/api/.dev.vars
vp run dev              # 根 dev 任务，just dev 会在 migration 后调用它
vp run build            # 构建 driver 和 web
vp run fmt              # 格式化
vp run fmt:check        # 检查格式
vp run lint             # 先生成 Cloudflare types，再执行 lint
vp run tc               # 执行 workspace typecheck
vp run test             # 执行常规单元测试
vp run check            # fmt:check + lint + tc + test
vp run graphql:codegen  # 重新生成 GraphQL schema 与 Web gql 输出
vp run db:regen         # 按当前 schema 重新生成 Drizzle baseline
```

开发中优先使用聚焦命令，反馈更快：

```bash
vp run --filter @mosoo/api tc
vp run --filter @mosoo/web test
vp exec bun test apps/api/tests/session-run-cancel.test.ts
```

## 数据库与 Migration

alpha 阶段不维护历史 migration。数据库策略保持简单：

- schema 真相源在 `pkgs/db/src/schema/**`
- 当前 baseline 在 `pkgs/db/drizzle/**`
- schema 与数据库状态不一致时，不为旧本地数据补兼容 patch
- 直接重建本地数据库状态

常用命令：

```bash
vp run db:regen
vp run db:migrate:local
```

如果本地数据库状态已经脏掉，删除对应本地数据库和 `.wrangler` 状态目录后再重建。生产发布也沿用同样的 no-history 姿态：除非当前 schema 明确支持，否则旧数据不视为兼容。

## GraphQL Codegen

GraphQL 的真相源分布如下：

- 字段和类型 spec：`apps/api/src/adapters/graphql/graphql-module-specs.ts`
- runtime resolver：`apps/api/src/modules/*/graphql/*-graphql.ts`
- API schema 入口：`apps/api/src/adapters/graphql/create-graphql-schema.ts`
- Codegen schema 输入：`apps/api/src/adapters/graphql/codegen-schema.ts`
- Codegen 配置：`dev/config/graphql-codegen.ts`
- Web 端 GraphQL 文档：`apps/web/src/**/*.{ts,tsx}` 中的 `graphql(/* GraphQL */)`

修改后端 schema、自定义 scalar 映射、前端 query、mutation 或 fragment 后，执行：

```bash
vp run graphql:codegen
```

如果生成结果暴露类型或字段漂移，回到 spec、resolver、contract 或 PRD 源头修正，不要补丁生成文件。

## 验证策略

默认根据风险和影响范围选择验证方式。项目仍处于 alpha，不要求每个小改动都新增测试，但高风险行为变更需要聚焦覆盖。

建议基线：

- 文档改动：`vp fmt --check <files>`，移动文档时补充链接 / 路径检查。
- TypeScript package 改动：对应 package 的 `tc`、聚焦单测；跨 contract 时再跑根 `vp run tc`。
- API 行为改动：聚焦 `bun test` 文件；涉及类型或 binding 时加 `@mosoo/api tc`。
- Web 行为改动：聚焦 Web 测试、`@mosoo/web tc`，用户可见流程需要浏览器或手动检查。
- GraphQL 改动：`vp run graphql:codegen`。
- DB schema 改动：`vp run db:regen` 和相关 API 测试。

E2E 入口：

```bash
vp run e2e:signal-contract
./e2e/run-deterministic.sh
./e2e/run-preview-smoke.sh
./e2e/run-preview-smoke.sh --headed
./e2e/run-preview-latency.sh
```

`run-deterministic.sh` 是无外部凭据的本地验收路径。Preview live harness 需要 provider key，例如 `MOSOO_E2E_OPENAI_API_KEY` 或 `MOSOO_E2E_PROVIDER_API_KEY`。

## 工程原则

保持改动小、直接，并贴合已有边界。

- 优先沿用当前项目模式，而不是引入新的抽象。
- 纯转换逻辑与 I/O、框架生命周期、平台 API 分离。
- 共享 contract、跨 package payload、公共 schema 只在确实跨边界时进入共享包。
- app 内局部类型、view model 和实现细节留在所属模块。
- TypeScript 保持严格类型，不引入 `any`。
- 导出 API 优先使用语义明确的命名类型，避免复杂内联类型污染接口。
- 平台特定实现只放在平台边界；共享包保持 runtime-neutral。
- 业务必需值和不变量应 fail fast，避免宽泛 `try/catch`、静默 fallback 或占位默认值掩盖问题。
- 一个用户概念只保留一套 canonical naming 或 command grammar。

前端补充：

- 先保持现有 UI 约定，再考虑新增交互模式。
- 优先使用生成的强类型 API 访问层。
- 不手写平行请求层。
- 不滥用 React Context 承载高频共享状态。
- 编辑 React 时，除非确实是外部同步，否则不要新增 `useEffect`。

数据访问与性能：

- 按访问路径显式设计查询。
- 列表排序默认优先 `ORDER BY id`，除非调用处明确要求其他顺序。
- 不在 ORM 层隐藏默认过滤或排序。
- 避免循环中的 N+1 查询，关联数据必须显式预加载。
- 超大表分页避免全量 `count()`，优先游标或估算值。

## 依赖策略

避免低价值第三方依赖。少量通用逻辑优先在仓库内实现。第三方服务交互优先手写轻量 typed API client，只有在 SDK 能明显降低复杂度时才引入。

## Branch、Commit、Issue 和 PR

Branch、commit 和 PR title 都遵循 Conventional Commits 语义。

Commit message 至少满足：

```text
type(scope): subject
```

示例：

```text
feat(channels): add telegram binding validation
fix(auth): reject invalid local backdoor email
chore(dev): move contribution guide to root
```

Branch name 使用同一组 type / scope 语义，推荐格式：

```text
type/scope-subject
```

示例：

```text
chore/contributing-guide
fix/auth-local-backdoor
chore/dev-docs-layout
```

只有有意引入 breaking change 时才使用 `!`。所有 Issue 和 PR 必须 self assign。PR 应保持范围清晰，写明验证结果，并明确标注是否包含生成文件、GraphQL codegen 或 DB baseline 更新。

## 部署说明

生产部署脚本已经存在，但不是日常贡献流程的一部分：

```bash
vp run deploy:api
vp run deploy:web
vp run deploy
```

API 生产配置在 `apps/api/wrangler.toml`，Web 生产配置在 `apps/web/wrangler.toml`。Cloudflare routes 将 `mosoo.ai/api/*` 指向 API Worker，将 `mosoo.ai/*` 指向 Web Worker。

不要从未经 review 的本地分支直接部署生产。
