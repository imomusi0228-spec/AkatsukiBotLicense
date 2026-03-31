const { Pool } = require('pg');
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
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error('Error querying schema:', err);
    } finally {
        await pool.end();
    }
}

main();
