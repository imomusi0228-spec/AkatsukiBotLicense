const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
    try {
        const res = await pool.query('SELECT plan_type, COUNT(*) FROM licenses GROUP BY plan_type');
        console.log('--- License Count by Plan ---');
        console.table(res.rows);
    } catch (e) {
        console.error(e.message);
    } finally {
        await pool.end();
    }
}
check();
