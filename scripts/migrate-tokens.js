// filename: scripts/migrate-tokens.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        console.log('[Migration] Adding columns to orders table...');
        await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_discord_id VARCHAR(50)');
        await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS activation_token VARCHAR(100)');
        await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS token_sent BOOLEAN DEFAULT FALSE');
        console.log('[Migration] Migration completed successfully.');
    } catch (err) {
        console.error('[Migration] Error during migration:', err);
    } finally {
        await pool.end();
    }
}

migrate();
