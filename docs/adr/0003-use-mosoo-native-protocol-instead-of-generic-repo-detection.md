---
status: accepted
---

# 使用 Mosoo Native Protocol 而不是通用 Repo 检测

Mosoo Deploy 只部署被刻意写成 Mosoo Native Deployable 的 repository，而不是通过 Railway / Nixpacks 式 framework detection 去猜任意 repo。短期 authoring surface 是 Codex、本地 coding agent、Mosoo Skill 和 Mosoo CLI；长期 authoring surface 是 Mosoo App Builder。这个决定拒绝 generic PaaS compatibility，选择 Mosoo-specific protocol，让 Mosoo 能用自己可验证、可运营的语言描述 Agent definition、delegation、exposure、setup requirements 和 hosted Web deployment。
