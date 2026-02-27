const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function check() {
    try {
        const res = await pool.query("SELECT COUNT(*) FROM scheduled_announcements WHERE sent_at IS NOT NULL");
        console.log(`Sent announcements count: ${res.rows[0].count}`);
    } catch (e) {
        console.error(e.message);
    } finally {
        await pool.end();
    }
}
check();
