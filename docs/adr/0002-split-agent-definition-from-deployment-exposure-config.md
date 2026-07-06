---
status: accepted
---

# 拆分 Agent Definition Set 和 Deployment Exposure Config

Mosoo Native Protocol v1 应该把可复用的 Agent definition set 放在 Agent definition surface，把 repo-local deployment exposure 放在 deployment exposure surface。Agent definition surface 可以描述一个 primary Agent，也可以描述多个 named App-local Agents；它负责 identity、behavior、runtime intent、Skills、MCP 和 Environment requirements。Deployment exposure 负责 Web surface configuration、hosted code 的 target-Agent binding、binding names、build / deploy overrides、host-layer configuration 和 setup requirements。Agent API Endpoint 是 Agent deploy 的默认输出，不是单独的 `.mosoo.toml` surface。

这个拆分让 `.agent` 的可搬运性继续对齐现有 Agent package 语义，同时允许一个 repo 声明 Mosoo 应该如何 expose 或 host 部署结果。代价是引入两类文件的心智模型，并且仍要决定最终 Native file / action shape；alpha 阶段的 manifest 字段形态和 `.mosoo.toml schema = 1` 细节不是长期兼容约束。Secrets 不属于任何一个 surface；deployable files 只能包含 credential reference 或 post-deploy setup requirement。

多 Agent 精化（2026-07-07）：Agent definition surface 覆盖 repo 内全部 Agents（single-Agent 只是简写）；exposure surface 的职责精确为 per-agent expose 子集（哪些 Agent 获得 App namespace 下的公开 endpoint，其余 defined-but-internal）加 Web env binding。后果：deploy 按定义 upsert 而不是按名绑定预先存在的已发布 Agent，`deployment_agent_not_found` 不再是跨实例失败类别。契约细节见 [docs/prd/mosoo-native-deployment-protocol.md](../prd/mosoo-native-deployment-protocol.md)。
