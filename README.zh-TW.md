<p align="center">
  <img src="docs/assets/mosoo-banner.png" alt="mosoo" />
</p>

<h1 align="center">mosoo</h1>

<p align="center">
  <strong>面向程式設計智能體的開源智能體執行階段。</strong><br />
  在隔離的 AI 智能體沙箱中，透過 API 端點執行 OpenAI Codex、Claude Agent SDK 和 OpenCode。
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/langgenius/mosoo" alt="License" /></a>
  <a href="#product-status"><img src="https://img.shields.io/badge/status-alpha-orange" alt="Status: Alpha" /></a>
</p>

<p align="center">
  <a href="https://cloud.mosoo.ai">試用 mosoo</a> ·
  <a href="https://mosoo.ai">官網</a> ·
  <a href="https://mosoo.ai/docs">API 文件</a> ·
  <a href="https://github.com/langgenius/mosoo-connector">mosoo 連接器</a>
</p>

mosoo 提供基於 Cloudflare 的控制平面，用於串流工具活動、檢查執行歷史記錄，並在多次執行之間保留執行緒和檔案。你可以在自己的帳戶中自行託管。

你的應用始終屬於你。其後端擁有產品行為和終端使用者存取權限。mosoo 專注於智能體執行和生命週期管理；應用部署是獨立的 Alpha 功能，不屬於核心產品契約。

## 運作原理

```text
設定智能體 + 技能 + MCP + 模型供應商
  -> 預覽並發布智能體版本
  -> 從後端或 mosoo 主控台呼叫
  -> 串流事件、處理權限請求、檢查檔案和使用情況
  -> 跨多次執行繼續持久化執行緒
```

## 功能特性

智能體執行階段和 API 目前支援的功能：

- **智能體執行階段和控制平面。** 在一個統一的執行階段協定下設定和執行 OpenAI Codex、Claude Agent SDK 和 OpenCode。
- **智能體 API。** 從受信任的後端啟動、追蹤、繼續、停止、封存和刪除智能體工作。
- **AI 智能體沙箱。** 在隔離的執行環境中串流回應和工具活動、處理權限請求、取消工作並檢查診斷資訊。
- **持久化工作。** 在多次執行之間保留執行緒、執行、事件和託管檔案。
- **智能體可觀測性。** 檢查執行狀態、可重播的活動、診斷資訊和使用量估算；這是維運可見性，而非合規稽核追蹤或供應商帳單。

## 適用對象

mosoo 面向將 Codex、Claude Agent SDK、OpenCode 或其他程式設計智能體擴展為產品和自動化能力的開發者，他們不想為每個整合單獨維運智能體執行階段、沙箱服務、工作階段儲存、檔案管線和智能體 API。

## 產品狀態

mosoo 處於 Alpha 階段。上述託管執行階段和智能體 API 已發布並通過儲存庫測試覆蓋，但生產可靠性和外部採用尚未驗證。公開 API 和產品行為仍可能變更。

## 快速開始

體驗 mosoo 最快的方式是使用託管主控台 [cloud.mosoo.ai](https://cloud.mosoo.ai)。如需自行執行，請按以下步驟從乾淨複製開始自行託管。

### 前置條件

- `bun >= 1.4.0-canary.1`
- `just >= 1.51`
- 用於智能體執行階段和沙箱流程的 Docker 相容守護程序

### 本機執行

```bash
git clone --recurse-submodules https://github.com/langgenius/mosoo.git
cd mosoo
just setup
just dev
```

`just setup` 安裝依賴、初始化子模組、建立或補全 `apps/api/.dev.vars`、安裝 Git 掛鉤，並套用待處理的本機 D1 遷移。`just dev` 在啟動 Web 和 API 開發伺服器之前重新套用待處理的遷移。

本機位址：

- Web：`http://localhost:5173`
- API：`http://localhost:8787`

基本煙霧測試：

```bash
curl http://localhost:5173/api/health
curl http://localhost:8787/api/health
```

API 健康檢查路徑為 `/api/health`，而非 `/health`。mosoo 控制平面開發登入使用 OTP；在本機回環來源下，以 `@mosoo.ai` 結尾的電子郵件地址可跳過 OTP 直接登入。

### 疑難排解

如果設定失敗，請從以下針對性方案開始：子模組問題使用 `git submodule update --init`，缺少本機金鑰使用 `just env-init`，D1 結構描述錯誤使用 `just db-migrate`。完整工作流程和驗證要求請參閱 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 範例：建置 Codex 智能體 API

[Codex Pet](https://mosoo.ai/en/use-cases/codex-pet) 展示了一個已發布的 mosoo 智能體透過執行緒 API 整合到現有產品後端。相同的 API 可以暴露基於 Claude Agent SDK 或 OpenCode 的智能體。

https://github.com/user-attachments/assets/4a4bbaab-c192-4462-99e0-020eab966fff

## 文件

- API 文件：[mosoo.ai/docs](https://mosoo.ai/docs)
- 規範產品契約：[docs/SPEC.md](./docs/SPEC.md)
- 目前實作架構：[docs/architecture.md](./docs/architecture.md)
- 正式環境 SLO 和事件策略：[docs/operations/reliability.md](./docs/operations/reliability.md)
- PRD 索引和歷史實作契約：[docs/prd/README.md](./docs/prd/README.md)

公開登陸頁面和部落格位於私有儲存庫 `langgenius/mosoo-website`，並獨立部署在 `mosoo.ai`。

## 社群與支援

- 錯誤回報和功能請求：[GitHub Issues](https://github.com/langgenius/mosoo/issues)
- 產品更新：[mosoo.ai](https://mosoo.ai)

## 貢獻

歡迎貢獻。請閱讀 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解開發工作流程、提交策略和驗證要求。貢獻受 [貢獻者授權合約](./CLA.md) 約束；CLA 助手將在你的首次拉取請求時提示你。

## 授權

mosoo 基於 [Apache License 2.0](./LICENSE) 授權。