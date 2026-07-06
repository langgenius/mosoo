---
status: accepted
---

# 使用 Mosoo Native Protocol 而不是通用 Repo 检测

Mosoo Deploy 只部署被刻意写成 Mosoo Native Deployable 的 repository，而不是通过 Railway / Nixpacks 式 framework detection 去猜任意 repo。短期 authoring surface 是 Codex、本地 coding agent、Mosoo Skill 和 Mosoo CLI；长期 authoring surface 是 Mosoo App Builder。这个决定拒绝 generic PaaS compatibility，选择 Mosoo-specific protocol，让 Mosoo 能用自己可验证、可运营的语言描述 Agent definition、delegation、exposure、setup requirements 和 hosted Web deployment。

代码证据与边界句（2026-07-07 补充）：当前 detector 是文件白名单快照（`app-deployment-executor.service.ts:83`）加 `.mosoo.toml schema = 1` 解析（`app-deployment-detector.ts:789`）；检测失败在 console 退化为 null-label "detecting target"（`deployments-history.tsx:129`）。边界句（推荐默认，Phase 0 入口确认）：Native marker 存在 → 协议路径；无 Agent 的普通 static/worker repo → 沿用现有 generic detector；协议 repo 永不回落到 generic 检测，缺协议文件是 authoring error。契约细节见 [docs/prd/mosoo-native-deployment-protocol.md](../prd/mosoo-native-deployment-protocol.md)。
