<p align="center">
  <img src="docs/assets/mosoo-banner.png" alt="mosoo" />
</p>

<h1 align="center">mosoo</h1>

<p align="center">
  <strong>面向编程智能体的开源智能体运行时。</strong><br />
  在隔离的 AI 智能体沙箱中，通过 API 端点运行 OpenAI Codex、Claude Agent SDK 和 OpenCode。
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/langgenius/mosoo" alt="License" /></a>
  <a href="#product-status"><img src="https://img.shields.io/badge/status-alpha-orange" alt="Status: Alpha" /></a>
</p>

<p align="center">
  <a href="https://cloud.mosoo.ai">试用 mosoo</a> ·
  <a href="https://mosoo.ai">官网</a> ·
  <a href="https://mosoo.ai/docs">API 文档</a> ·
  <a href="https://github.com/langgenius/mosoo-connector">mosoo 连接器</a>
</p>

mosoo 提供基于 Cloudflare 的控制平面，用于流式传输工具活动、检查运行历史记录，并在多次执行之间保留线程和文件。你可以在自己的账户中自托管。

你的应用始终属于你。其后端拥有产品行为和最终用户访问权限。mosoo 专注于智能体执行和生命周期管理；应用部署是独立的 Alpha 功能，不属于核心产品契约。

## 工作原理

```text
配置智能体 + 技能 + MCP + 模型供应商
  -> 预览并发布智能体版本
  -> 从后端或 mosoo 控制台调用
  -> 流式传输事件、处理权限请求、检查文件和使用情况
  -> 跨多次运行继续持久化线程
```

## 功能特性

智能体运行时和 API 目前支持的功能：

- **智能体运行时和控制平面。** 在一个统一的运行时协议下配置和运行 OpenAI Codex、Claude Agent SDK 和 OpenCode。
- **智能体 API。** 从受信任的后端启动、跟踪、继续、停止、归档和删除智能体工作。
- **AI 智能体沙箱。** 在隔离的执行环境中流式传输响应和工具活动、处理权限请求、取消工作并检查诊断信息。
- **持久化工作。** 在多次执行之间保留线程、运行、事件和托管文件。
- **智能体可观测性。** 检查运行状态、可回放的活动、诊断信息和使用量估算；这是运维可见性，而非合规审计跟踪或供应商账单。

## 适用人群

mosoo 面向将 Codex、Claude Agent SDK、OpenCode 或其他编程智能体扩展为产品和自动化能力的开发者，他们不想为每个集成单独运维智能体运行时、沙箱服务、会话存储、文件管道和智能体 API。

## 产品状态

mosoo 处于 Alpha 阶段。上述托管运行时和智能体 API 已发布并通过仓库测试覆盖，但生产可靠性和外部采用尚未验证。公共 API 和产品行为仍可能发生变化。

## 快速开始

体验 mosoo 最快的方式是使用托管控制台 [cloud.mosoo.ai](https://cloud.mosoo.ai)。如需自行运行，请按以下步骤从干净克隆开始自托管。

### 前置条件

- `bun >= 1.4.0-canary.1`
- `just >= 1.51`
- 用于智能体运行时和沙箱流程的 Docker 兼容守护进程

### 本地运行

```bash
git clone --recurse-submodules https://github.com/langgenius/mosoo.git
cd mosoo
just setup
just dev
```

`just setup` 安装依赖、初始化子模块、创建或补全 `apps/api/.dev.vars`、安装 Git 钩子，并应用待处理的本地 D1 迁移。`just dev` 在启动 Web 和 API 开发服务器之前重新应用待处理的迁移。

本地地址：

- Web：`http://localhost:5173`
- API：`http://localhost:8787`

基本冒烟测试：

```bash
curl http://localhost:5173/api/health
curl http://localhost:8787/api/health
```

API 健康检查路径为 `/api/health`，而非 `/health`。mosoo 控制平面开发登录使用 OTP；在本地回环来源下，以 `@mosoo.ai` 结尾的邮箱地址可跳过 OTP 直接登录。

### 故障排除

如果设置失败，请从以下针对性方案开始：子模块问题使用 `git submodule update --init`，缺少本地密钥使用 `just env-init`，D1 模式错误使用 `just db-migrate`。完整工作流程和验证要求请参见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 示例：构建 Codex 智能体 API

[Codex Pet](https://mosoo.ai/en/use-cases/codex-pet) 展示了一个已发布的 mosoo 智能体通过线程 API 集成到现有产品后端。同样的 API 可以暴露基于 Claude Agent SDK 或 OpenCode 的智能体。

https://github.com/user-attachments/assets/4a4bbaab-c192-4462-99e0-020eab966fff

## 文档

- API 文档：[mosoo.ai/docs](https://mosoo.ai/docs)
- 规范产品契约：[docs/SPEC.md](./docs/SPEC.md)
- 当前实现架构：[docs/architecture.md](./docs/architecture.md)
- 生产 SLO 和事件策略：[docs/operations/reliability.md](./docs/operations/reliability.md)
- PRD 索引和历史实现契约：[docs/prd/README.md](./docs/prd/README.md)

公共落地页和博客位于私有仓库 `langgenius/mosoo-website`，并独立部署在 `mosoo.ai`。

## 社区与支持

- 错误报告和功能请求：[GitHub Issues](https://github.com/langgenius/mosoo/issues)
- 产品更新：[mosoo.ai](https://mosoo.ai)

## 贡献

欢迎贡献。请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解开发工作流程、提交策略和验证要求。贡献受 [贡献者许可协议](./CLA.md) 约束；CLA 助手将在你的首次拉取请求时提示你。

## 许可证

mosoo 基于 [Apache License 2.0](./LICENSE) 许可。