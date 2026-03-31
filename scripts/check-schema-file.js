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
            WHERE table_name IN ('licenses', 'subscriptions') 
            ORDER BY table_name, ordinal_position
        `);
        fs.writeFileSync('db_schema_debug.json', JSON.stringify(res.rows, null, 2));
        console.log('Schema written to db_schema_debug.json');
    } catch (err) {
        console.error('Error querying schema:', err);
    } finally {
        await pool.end();
    }
}

main();
