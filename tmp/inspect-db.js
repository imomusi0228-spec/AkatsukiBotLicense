const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function inspect() {
    try {
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log('--- Tables ---');
        console.table(tables.rows);

        for (const table of tables.rows) {
            const columns = await pool.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1
            `, [table.table_name]);
            console.log(`--- Columns in ${table.table_name} ---`);
            console.table(columns.rows);
        }
    } catch (e) {
        console.error(e.message);
    } finally {
        await pool.end();
    }
}
inspect();
