// filename: scripts/test-db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log('[Test] Attempting to create a simple table...');
        await pool.query('CREATE TABLE IF NOT EXISTS "test_table" (id SERIAL PRIMARY KEY, name TEXT)');
        console.log('[Test] Simple table created successfully!');
        
        console.log('[Test] Attempting "orders" table with quotes...');
        await pool.query('CREATE TABLE IF NOT EXISTS "orders" (id SERIAL PRIMARY KEY, order_num TEXT)');
        console.log('[Test] "orders" table created successfully!');
    } catch (err) {
        console.error('[Test] FAIL:', err);
    } finally {
        await pool.end();
    }
}

run();
