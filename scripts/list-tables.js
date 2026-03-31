const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function main() {
    try {
        const res = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error('Error querying tables:', err);
    } finally {
        await pool.end();
    }
}

main();
