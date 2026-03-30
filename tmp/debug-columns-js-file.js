const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function debug() {
    try {
        const res1 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'licenses'");
        const res2 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'subscriptions'");
        
        const output = {
            licenses: res1.rows.map(r => r.column_name),
            subscriptions: res2.rows.map(r => r.column_name)
        };
        
        fs.writeFileSync('tmp/columns.json', JSON.stringify(output, null, 2));
        console.log('Success - check tmp/columns.json');
    } finally {
        await pool.end();
    }
}
debug();
