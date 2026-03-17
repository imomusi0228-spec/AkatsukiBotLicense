-- filename: sql/init.sql
-- BOOTH購入メール連携・自動ライセンス発行システム 初期化スクリプト

-- 1. 注文管理テーブル (orders)
-- BOOTHから届いたメール情報を正規化して保存
CREATE TABLE IF NOT EXISTS "orders" (
  id SERIAL PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  order_number_normalized TEXT UNIQUE NOT NULL,
  buyer_email TEXT NULL,
  buyer_email_normalized TEXT NULL,
  product_name TEXT NOT NULL,
  plan_type TEXT NOT NULL,
  source_message_id TEXT NULL,
  raw_subject TEXT NULL,
  raw_body TEXT NULL,
  mail_received_at TIMESTAMP NULL,
  used BOOLEAN DEFAULT FALSE,
  used_by_discord_id TEXT NULL,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. ライセンス管理テーブル (licenses)
-- 発行されたライセンスキーと現在のステータスを管理
CREATE TABLE IF NOT EXISTS "licenses" (
  id SERIAL PRIMARY KEY,
  license_key TEXT UNIQUE NOT NULL,
  discord_id TEXT NOT NULL,
  order_id INTEGER REFERENCES "orders"(id) ON DELETE SET NULL,
  plan_type TEXT NOT NULL,
  product_name TEXT NOT NULL,
  max_servers INTEGER NOT NULL,
  activated_servers INTEGER DEFAULT 0,
  expires_at TIMESTAMP NULL,
  is_active BOOLEAN DEFAULT TRUE,
  revoked_at TIMESTAMP NULL,
  revoked_reason TEXT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. アクティベーション管理テーブル (activations)
-- デバイス（Machine ID）ごとの認証状態を管理
CREATE TABLE IF NOT EXISTS "activations" (
  id SERIAL PRIMARY KEY,
  license_id INTEGER REFERENCES "licenses"(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL,
  machine_id_normalized TEXT NOT NULL,
  device_name TEXT NULL,
  ip_address TEXT NULL,
  first_activated_at TIMESTAMP DEFAULT NOW(),
  last_verified_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(license_id, machine_id_normalized)
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
  id SERIAL PRIMARY KEY,
  action_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NULL,
  details JSONB NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- インデックスの作成
CREATE INDEX IF NOT EXISTS idx_orders_order_number_normalized ON orders(order_number_normalized);
CREATE INDEX IF NOT EXISTS idx_licenses_discord_id ON licenses(discord_id);
CREATE INDEX IF NOT EXISTS idx_licenses_license_key ON licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_activations_license_machine ON activations(license_id, machine_id_normalized);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
