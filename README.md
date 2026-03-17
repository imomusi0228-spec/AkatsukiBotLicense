// filename: README.md
# BOOTH購入メール連携・自動ライセンス発行システム

このシステムは、BOOTHでの商品購入を自動で検知し、Discord上でライセンスを即座に発行・管理するための統合ソリューションです。

## 🚀 主な機能
- **自動メール監視**: GmailをIMAPで監視し、BOOTHの購入通知から注文情報を自動抽出。
- **インスタント発行**: `/activate` コマンドで注文番号を入力するだけでライセンスキーを発行。
- **ロール自動付与**: プランに応じたDiscordロールを自動的に割り当て。
- **デバイス制限**: 1つのライセンスで利用できるデバイス（サーバー/PC）の数を厳密に管理。
- **管理者ツール**: ライセンスの失効、デバイスリセット、注文調査などをDiscord上から実行可能。
- **外部認証API**: デスクトップアプリ等がライセンスの有効性を確認できるAPIサーバー。

## 🛠 セットアップ手順

### 1. データベースの初期化
PostgreSQLに接続し、`sql/init.sql` の内容を実行してください。必要なテーブル（orders, licenses, activations, audit_logs）が作成されます。

### 2. 環境変数の設定
`.env` ファイルを作成し、以下の項目を設定してください（`src/config/env.js` を参照）。

```env
DISCORD_TOKEN=あなたのBotトークン
CLIENT_ID=BotのクライアントID
GUILD_ID=導入先のサーバーID
DATABASE_URL=postgres://...
GMAIL_USER=あなたのGmailアドレス
GMAIL_APP_PASSWORD=Gmailのアプリパスワード（16桁）
ADMIN_DISCORD_IDS=管理者のDiscordID（カンマ区切り）

# ロールID
ROLE_FREE_ID=...
ROLE_PRO_ID=...
ROLE_PROPLUS_ID=...
ROLE_ULTIMATE_ID=...
```

### 3. ライブラリのインストール
```bash
npm install discord.js express dotenv pg imap mailparser node-cron crypto helmet cors zod dayjs winston winston-daily-rotate-file
```

### 4. コマンドの登録
```bash
node src/bot/deploy-commands.js
```

### 5. 起動
```bash
npm start
```

## 📝 管理者用コマンド一覧
- `/lookuporder [注文番号]`: 注文の有無や使用状況を調査。
- `/revokelicense [キー] [理由]`: ライセンスを即座に無効化。
- `/resetlicense [キー]`: デバイス認証をすべてリセット（救済用）。

## 📁 フォルダ構成
- `src/bot/`: Discord Botの実装
- `src/api/`: 認証APIサーバーの実装
- `src/services/`: ビジネスロジック（メール、注文、ライセンス）
- `src/utils/`: 共通ユーティリティ（解析、正規化、生成）
- `sql/`: 初期化スクリプト
