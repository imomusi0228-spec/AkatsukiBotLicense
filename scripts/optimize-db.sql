-- データベース高速化のためのインデックス追加
-- 万単位のユーザーを管理する際、検索と表示のパフォーマンスを向上させます。

-- 1. サブスクリプション管理の高速化
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_guild_id ON subscriptions(guild_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_expiry_date ON subscriptions(expiry_date);

-- 2. 申請管理の高速化
CREATE INDEX IF NOT EXISTS idx_applications_author_id ON applications(author_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

-- 3. 監査ログ・操作ログの高速化（ログが大量になっても表示を速くする）
CREATE INDEX IF NOT EXISTS idx_operation_logs_action ON operation_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_operation_logs_created_at ON operation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_logs_operator ON operation_logs(operator_id);

-- 4. ブラックリスト・セキュリティの高速化
CREATE INDEX IF NOT EXISTS idx_blacklist_target_id ON blacklist(target_id);

-- 統計情報の更新
ANALYZE;
