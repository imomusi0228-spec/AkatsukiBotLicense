const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
    try {
        const res = await pool.query('SELECT tier, COUNT(*) FROM subscriptions GROUP BY tier');
        fs.writeFileSync('tmp/subs.json', JSON.stringify(res.rows, null, 2));
    } finally {
        await pool.end();
    }
}
check();
