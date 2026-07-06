---
status: accepted
---

# 使用 Mosoo Native Deployment Protocol 作为 Agent App 可部署契约

Mosoo 将定义版本化的 Mosoo Native Deployment Protocol，用来描述 coding agent 产出的 repo 如何被 Mosoo 部署。这个方向取代三件事：让用户选择硬 App 类型、引入 generic Service entity、把 Mosoo 做成通用 process host。协议中心是 Agent / Session / Delegation 语义：Agent 如何被装备，一次委托如何被受理，请求从哪里进入，结果送到哪里。

这个决定难以回滚，因为 protocol 会成为 coding agent 的采用入口，也会成为 deployable repo 的兼容承诺。它也是一个明确取舍：Railway 的 process waist 已经商品化，Mosoo 只有在平台能看见 Thread history、retry、permission、cost、human review、Channel delivery、Agent API Endpoint 和 Agent state 的地方，才有差异化价值。因此 protocol 必须配套公开版本、一页 coding-agent instruction，以及能给出 file / field 级错误的 validate 入口。

后果补充（2026-07-07，来自 happy-path / workplan 收敛）：机制修正——当前 pipeline 的缺陷不是"UUID 进 repo"，而是 repo 只能按名*引用*、不能*定义* Agent；Agent identity 是实例状态，deploy 按名绑定预先存在的已发布 Agent（`app-agent-binding-resolution.ts:41`），所以 artifact 天生不自足。修复 = repo 内定义 + 部署时 upsert。协议落地后，两个上线动词（publishAgent / deployApp）收敛到同一个 artifact；可度量后果是 portability SLO：协议合法的 repo 在从未见过的实例上零改动部署成功的比例。契约细节见单一事实来源 [docs/prd/mosoo-native-deployment-protocol.md](../prd/mosoo-native-deployment-protocol.md)。
