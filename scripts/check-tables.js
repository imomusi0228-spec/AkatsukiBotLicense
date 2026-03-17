// filename: scripts/check-tables.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        console.log('Current Tables:', res.rows.map(r => r.table_name).join(', '));
    } catch (err) {
        console.error('Check FAIL:', err);
    } finally {
        await pool.end();
    }
}

run();
