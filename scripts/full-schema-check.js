const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function main() {
    try {
        const res = await pool.query(`
            SELECT table_name, column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
        `);
        fs.writeFileSync('full_db_schema.json', JSON.stringify(res.rows, null, 2));
        console.log('Full schema written to full_db_schema.json');
    } catch (err) {
        console.error('Error querying full schema:', err);
    } finally {
        await pool.end();
    }
}

main();
