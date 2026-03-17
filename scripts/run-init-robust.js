// filename: scripts/run-init-robust.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const statements = [
    `CREATE TABLE IF NOT EXISTS "orders" (
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
    )`,
    `CREATE TABLE IF NOT EXISTS "licenses" (
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
    )`,
    `CREATE TABLE IF NOT EXISTS "activations" (
        id SERIAL PRIMARY KEY,
        license_id INTEGER REFERENCES "licenses"(id) ON DELETE CASCADE,
        machine_id TEXT NOT NULL,
        machine_id_normalized TEXT NOT NULL,
        device_name TEXT NULL,
        ip_address TEXT NULL,
        first_activated_at TIMESTAMP DEFAULT NOW(),
        last_verified_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(license_id, machine_id_normalized)
    )`,
    `CREATE TABLE IF NOT EXISTS "audit_logs" (
        id SERIAL PRIMARY KEY,
        action_type TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NULL,
        details JSONB NULL,
        created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_orders_num ON "orders"(order_number_normalized)`,
    `CREATE INDEX IF NOT EXISTS idx_licenses_owner ON "licenses"(discord_id)`,
    `CREATE INDEX IF NOT EXISTS idx_licenses_key ON "licenses"(license_key)`,
    `CREATE INDEX IF NOT EXISTS idx_activations_main ON "activations"(license_id, machine_id_normalized)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_action ON "audit_logs"(action_type)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_time ON "audit_logs"(created_at)`
];

async function run() {
    console.log('[RobustInit] Starting database initialization...');
    for (const sql of statements) {
        const tableName = sql.match(/IF NOT EXISTS "(\w+)"/)?.[1] || 'Index/Constraint';
        try {
            await pool.query(sql);
            console.log(`[RobustInit] SUCCESS: ${tableName}`);
        } catch (err) {
            console.error(`[RobustInit] FAIL: ${tableName}`, err.message);
        }
    }
    await pool.end();
    console.log('[RobustInit] All done.');
}

run();
