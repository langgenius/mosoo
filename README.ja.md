<p align="center">
  <img src="docs/assets/mosoo-banner.png" alt="mosoo" />
</p>

<h1 align="center">mosoo</h1>

<p align="center">
  <strong>コーディングエージェントのためのオープンソースエージェントランタイム。</strong><br />
  隔離された AI エージェントサンドボックス内で、API エンドポイントを通じて OpenAI Codex、Claude Agent SDK、OpenCode を実行します。
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/langgenius/mosoo" alt="License" /></a>
  <a href="#product-status"><img src="https://img.shields.io/badge/status-alpha-orange" alt="Status: Alpha" /></a>
</p>

<p align="center">
  <a href="https://cloud.mosoo.ai">mosoo を試す</a> ·
  <a href="https://mosoo.ai">ウェブサイト</a> ·
  <a href="https://mosoo.ai/docs">API ドキュメント</a> ·
  <a href="https://github.com/langgenius/mosoo-connector">mosoo コネクター</a>
</p>

mosoo は、ツールアクティビティのストリーミング、実行履歴の検査、実行間でのスレッドとファイルの保持を行う Cloudflare ネイティブのコントロールプレーンを提供します。自分のアカウントでセルフホストできます。

アプリケーションは常にあなたのものです。そのバックエンドが製品の動作とエンドユーザーアクセスを所有します。mosoo はエージェントの実行とライフサイクルに焦点を当てています。アプリのデプロイは独立した Alpha 機能であり、コア製品契約ではありません。

## 仕組み

```text
エージェント + スキル + MCP + プロバイダーを設定
  -> エージェントバージョンをプレビューして公開
  -> バックエンドまたは mosoo コンソールから呼び出す
  -> イベントのストリーミング、権限リクエストの処理、ファイルと使用状況の検査
  -> 複数の実行にわたって永続スレッドを継続
```

## 機能

エージェントランタイムと API で現在動作するもの：

- **エージェントランタイムとコントロールプレーン。** 統一されたランタイムプロトコルで OpenAI Codex、Claude Agent SDK、OpenCode を設定・実行します。
- **エージェント API。** 信頼されたバックエンドからエージェントの作業を開始、追跡、継続、停止、アーカイブ、削除します。
- **AI エージェントサンドボックス。** 隔離された実行環境でレスポンスとツールアクティビティをストリーミングし、権限リクエストを処理し、作業をキャンセルし、診断情報を検査します。
- **永続的な作業。** 個々の実行をまたいでスレッド、実行、イベント、管理ファイルを保持します。
- **エージェントの可観測性。** 実行ステータス、再生可能なアクティビティ、診断、使用量の見積もりを検査します。これは運用の可視性であり、コンプライアンス監査証跡やプロバイダー請求書ではありません。

## 対象ユーザー

mosoo は、Codex、Claude Agent SDK、OpenCode、または他のコーディングエージェントを製品や自動化に拡張する開発者向けです。統合ごとに個別のエージェントランタイム、サンドボックスサービス、セッションストア、ファイルパイプライン、エージェント API を運用したくない方を対象としています。

## 製品ステータス

mosoo は Alpha 段階です。上記のマネージドランタイムとエージェント API はリリース済みでリポジトリテストでカバーされていますが、本番環境での信頼性と外部での採用はまだ証明されていません。公開 API と製品の動作は変更される可能性があります。

## はじめ方

mosoo を試す最も速い方法は、ホストされたコンソール [cloud.mosoo.ai](https://cloud.mosoo.ai) です。自分で実行するには、以下の手順でクリーンクローンからセルフホストしてください。

### 前提条件

- `bun >= 1.4.0-canary.1`
- `just >= 1.51`
- エージェントランタイムとサンドボックスフロー用の Docker 互換デーモン

### ローカルで実行

```bash
git clone --recurse-submodules https://github.com/langgenius/mosoo.git
cd mosoo
just setup
just dev
```

`just setup` は依存関係のインストール、サブモジュールの初期化、`apps/api/.dev.vars` の作成または補完、Git フックのインストール、保留中のローカル D1 マイグレーションの適用を行います。`just dev` は Web および API 開発サーバーを起動する前に保留中のマイグレーションを再適用します。

ローカル URL：

- Web：`http://localhost:5173`
- API：`http://localhost:8787`

最小限のスモークテスト：

```bash
curl http://localhost:5173/api/health
curl http://localhost:8787/api/health
```

API ヘルスチェックは `/api/health` であり、`/health` ではありません。mosoo コントロールプレーンの開発ログインは OTP を使用します；ローカルループバックオリジンでは、`@mosoo.ai` で終わるアドレスは OTP をスキップして直接ログインできます。

### トラブルシューティング

セットアップが失敗した場合は、以下の集中的なレシピから始めてください：サブモジュールの問題は `git submodule update --init`、不足しているローカルシークレットは `just env-init`、D1 スキーマエラーは `just db-migrate` を使用します。完全なワークフローと検証の期待値については [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

## 例：Codex エージェント API の構築

[Codex Pet](https://mosoo.ai/en/use-cases/codex-pet) は、公開された mosoo エージェントがスレッド API を通じて既存の製品バックエンドに統合される様子を示しています。同じ API で Claude Agent SDK や OpenCode をバックエンドとするエージェントも公開できます。

https://github.com/user-attachments/assets/4a4bbaab-c192-4462-99e0-020eab966fff

## ドキュメント

- API ドキュメント：[mosoo.ai/docs](https://mosoo.ai/docs)
- 正規の製品契約：[docs/SPEC.md](./docs/SPEC.md)
- 現在の実装アーキテクチャ：[docs/architecture.md](./docs/architecture.md)
- 本番 SLO とインシデントポリシー：[docs/operations/reliability.md](./docs/operations/reliability.md)
- PRD インデックスと履歴実装契約：[docs/prd/README.md](./docs/prd/README.md)

公開ランディングページとブログはプライベートリポジトリ `langgenius/mosoo-website` にあり、`mosoo.ai` に個別にデプロイされています。

## コミュニティとサポート

- バグ報告と機能リクエスト：[GitHub Issues](https://github.com/langgenius/mosoo/issues)
- 製品アップデート：[mosoo.ai](https://mosoo.ai)

## 貢献

貢献を歓迎します。開発ワークフロー、コミットポリシー、検証の期待値については [CONTRIBUTING.md](./CONTRIBUTING.md) をお読みください。貢献は [貢献者ライセンス契約](./CLA.md) の対象となります；CLA アシスタントが最初のプルリクエスト時にプロンプトを表示します。

## ライセンス

mosoo は [Apache License 2.0](./LICENSE) の下でライセンスされています。