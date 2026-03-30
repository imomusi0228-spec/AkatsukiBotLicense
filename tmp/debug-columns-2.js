const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function debug() {
    try {
        const res1 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'licenses'");
        console.log('Licenses:', JSON.stringify(res1.rows.map(r => r.column_name)));
        
        const res2 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'subscriptions'");
        console.log('Subscriptions:', JSON.stringify(res2.rows.map(r => r.column_name)));
    } finally {
        await pool.end();
    }
}
debug();
