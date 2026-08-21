# Mosoo TypeScript SDK Public Beta PRD

状态：已确认，进入发布验收。

## 目标

在一个月内发布 `@mosoo/sdk` Public Beta，让应用开发者在可信后端中调用已发布的 Mosoo Agent，而不必重复实现 Mosoo 的 HTTP 协议、Run 终态判断、错误处理、委托验证和重试安全逻辑。

首版成功标准不是“封装所有 API”，而是让一名未参与实现的开发者仅依赖文档，在 15 分钟内创建 Thread、保存恢复 ID，并取得同一个 Run 的类型化终态与规范最终输出。

## 用户与场景

- Agent App 开发者在 Node.js 后端或 Cloudflare Worker 中调用 Mosoo。
- 应用负责认证自己的用户，并把不可变的 opaque `userId` 传给 Mosoo。
- Mosoo API token 只保存在可信后端；浏览器和移动端不直接持有 token。
- 进程、队列消费或 Worker invocation 可能中断，后续进程必须能通过已保存的 `threadId` 和 `runId` 继续等待，而不重复创建任务。

## Public Beta 交付物

1. npm 公共包 `@mosoo/sdk@0.1.0-beta.0`，通过 `beta` dist-tag 发布，ESM-only，支持 Node.js 22/24 LTS 和 Cloudflare Workers。
2. 自包含的 TypeScript wire types，不依赖 Mosoo 私有 workspace package。
3. 低层 Thread、Run、File 和 event 方法，以及先返回 ID、再等待终态的可恢复任务流程。
4. 类型化终态、规范 `finalOutput`、结构化错误，以及 #505 定义的 Run 关联 artifacts。
5. WebCrypto 实现的 `verifyDelegation()`，校验签名、允许算法、issuer、audience、时间边界、最大 lifetime 和必需 claims。
6. 调用方稳定 `idempotencyKey` 到 `Idempotency-Key` 的映射；示例不得在重试循环内生成新 key。
7. 英文和简体中文安装、快速开始、恢复、事件、文件、安全边界与错误文档。
8. 可重复的 npm Beta 发布 workflow、changelog、license 和发布/回滚手册。
9. GoGym 删除手写 Public Thread client、SSE parser 和 delegation verifier，仅保留应用认证、业务策略与 UI projection。

## 核心产品行为

### 创建与恢复

- `createThread()` 返回 `threadId` 和可选 `runId`，应用在等待前持久化它们。
- `waitForRun()` / `waitForFinalOutput()` 只以持久化 Thread/Run 快照判断终态。
- 新进程可用相同 ID 恢复等待；SDK 不静默创建替代 Thread。
- timeout 与 `AbortSignal` 只停止本地等待，不取消或删除远端任务。
- 指定 `runId` 与 Thread 最新 Run 不一致时显式失败，避免把其他 Run 的结果误当目标结果。

### 最终输出与进度

- `run.finalOutput` 是持久化的规范最终回答，不由 `agent.message.delta` 拼接得出。
- `streamEvents()` 和 event snapshot 是尽力而为的进度面；历史可能截断，不能作为完成正确性的来源。
- 失败、取消和过期 Run 返回类型化终态；高层 final-output helper 默认抛出结构化 terminal error。

### Run artifacts（#505）

- 已提交 artifact 在持久化 event、SSE、Thread file list 和终态 Run snapshot 中使用同一 `fileId` / `runId`。
- artifact 包含 `fileId`、`runId`、`name`、`mimeType`、`size` 和 `kind`。
- 支持多个产物与重名文件；消费者不得用文件名推断身份。
- 两个 Run 生成相同路径和内容时也各自获得 Run 关联 receipt。
- 下载继续使用现有 file content endpoint。

### 安全与重试

- 默认拒绝 browser-like runtime，除非调用方显式选择承担 token 风险。
- base URL、token、ID、poll interval、timeout 和 delegation claims 在信任边界校验。
- 同一逻辑 mutation 的重试复用同一 idempotency key；route 或 body 改变时使用新 key。
- delegation verification 不替代应用登录、业务授权、RLS 或 replay protection。

## 明确不在首版范围

- 无损、自动重连、跨多页历史对账的 `watchRun()`；需要服务端可分页历史契约后再提供。
- 浏览器、移动端、Bun 或 Deno runtime 支持。
- 高层大文件 upload-session / raw-content streaming；首版沿用 `Blob` / `FormData` 和现有 64 MiB API 限制。
- Go SDK、MCP server 生成、Tool schema、Supabase/RLS、应用 UI 和部署框架。
- exactly-once 外部副作用、provider-specific reconciliation 或完整产品时间线。

## 发布验收

- 主仓完整 `just check` 通过；新增迁移从空本地 D1 按 append-only 链成功应用。
- 同一 tarball 在干净 Node.js 22、Node.js 24 和真实 Cloudflare Workers runtime 中安装、类型检查并运行。
- GoGym 使用该 tarball 后，根项目与 MCP typecheck/test、Web build 和 Worker dry-run 通过。
- 英文/中文 OpenAPI 同步、类型检查、lint 和静态站点构建通过。
- 未参与 SDK 实现的开发者在 15 分钟内打印 `threadId`、`runId` 和终态 `finalOutput.text`。
- workflow 从已评审的 `main` commit 发布 npm Beta；发布后用 `npm install @mosoo/sdk@beta` 完成 clean-install smoke。

## 发布后候选项

只有真实采用证据证明需要时，才评估无损 `watchRun()`、原始字节流上传、Go SDK 和更高层 Agent App helper。
