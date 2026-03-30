const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
    try {
        const res = await pool.query('SELECT tier, COUNT(*) FROM subscriptions GROUP BY tier');
        console.log('--- Subscription Tiers ---');
        console.table(res.rows);
    } catch (e) {
        console.error(e.message);
    } finally {
        await pool.end();
    }
}
check();
