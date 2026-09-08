# TypeScript SDK Beta 发布

`@mosoo/sdk` 只从同一个已评审的 `main` commit 发布。发布入口是 GitHub Actions 的 **Release SDK** workflow；它会在 Node.js 22/24 和真实 Cloudflare Workers runtime 中验证打包产物，再通过 npm `beta` dist-tag 发布。

范围与发布验收以 [TypeScript SDK Public Beta PRD](./prd/typescript-sdk-public-beta.md) 为准。

## 首次发布前置

1. 确认维护者拥有 npm `@mosoo` organization 和 `@mosoo/sdk` 的公开发布权限。
2. 在 GitHub 创建受保护的 `npm` environment，并为发布设置人工审批。
3. 首次包尚不存在、无法配置 Trusted Publisher 时，只在 `npm` environment 中临时添加最小权限的 `NPM_TOKEN` 完成 bootstrap；workflow 仅在 secret 非空时导出 `NODE_AUTH_TOKEN`，不要把 Token 写入仓库或日志。
4. 首次发布后，在 npm 包设置中登记 Trusted Publisher：organization `langgenius`、repository `mosoo`、workflow `release-sdk.yml`、environment `npm`、allowed action `npm publish`。
5. 验证 OIDC 发布成功后删除临时 `NPM_TOKEN`。后续发布只使用 GitHub OIDC；workflow 的 `id-token: write` 不授予仓库写权限。

## 每次发布

1. 更新 `pkgs/public-api-client/package.json` 的 Beta 版本和 `CHANGELOG.md`，通过 PR 合入 `main`。
2. 在 Actions 手动运行 **Release SDK**，选择 `main`，通过 `npm` environment 审批。
3. workflow 会拒绝非 `-beta.*` 版本和已经存在的版本，执行 lint、类型检查、tarball 安装、Node/Worker runtime 测试和 `npm pack --dry-run` 后发布。
4. 验证 `npm view @mosoo/sdk dist-tags --json`，并在干净目录执行 `npm install @mosoo/sdk@beta`。
5. 首发后，在 GoGym 根目录和 `mcp/` 各执行一次 `bun install`，提交此前因 npm 404 无法生成的 SDK lockfile，再重跑 typecheck、test 和 Worker dry-run。
6. 从同一 commit 发布 GitHub Release Notes，复制对应 `CHANGELOG.md` 条目并注明 Beta 限制。

## 15 分钟发布验收

由一名未参与 SDK 实现的开发者执行。给他一个已发布 Agent、API token、文档预览链接和同一 commit 生成的 `.tgz`；除把 `npm install @mosoo/sdk@beta` 替换为 `npm install /path/to/mosoo-sdk-*.tgz` 外，不提供口头指导。

从拿到这些输入开始计时。通过条件是在干净的 Node.js 22 或 24 项目中打印同一 Run 的 `threadId`、`runId` 和终态 `finalOutput.text`，总耗时不超过 15 分钟。记录运行时版本、总耗时和所有文档阻塞；token 与真实业务内容必须脱敏。发布后再用 `npm install @mosoo/sdk@beta` 重跑一次安装 smoke，不重复计算产品验收时间。

npm 版本不可覆盖。若 Beta 有缺陷，发布新的 `-beta.N`，移动 `beta` dist-tag；不要把常规回滚建立在 unpublish 上。
