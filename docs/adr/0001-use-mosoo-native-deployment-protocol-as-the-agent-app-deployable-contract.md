---
status: accepted
---

# 使用 Mosoo Native Deployment Protocol 作为 Agent App 可部署契约

Mosoo 将定义版本化的 Mosoo Native Deployment Protocol，用来描述 coding agent 产出的 repo 如何被 Mosoo 部署。这个方向取代三件事：让用户选择硬 App 类型、引入 generic Service entity、把 Mosoo 做成通用 process host。协议中心是 Agent / Session / Delegation 语义：Agent 如何被装备，一次委托如何被受理，请求从哪里进入，结果送到哪里。

这个决定难以回滚，因为 protocol 会成为 coding agent 的采用入口，也会成为 deployable repo 的兼容承诺。它也是一个明确取舍：Railway 的 process waist 已经商品化，Mosoo 只有在平台能看见 Thread history、retry、permission、cost、human review、Channel delivery、Agent API Endpoint 和 Agent state 的地方，才有差异化价值。因此 protocol 必须配套公开版本、一页 coding-agent instruction，以及能给出 file / field 级错误的 dry-run validator。
