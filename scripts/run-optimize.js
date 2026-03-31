const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        const sqlPath = path.join(__dirname, 'optimize-db.sql');
        const rawSql = fs.readFileSync(sqlPath, 'utf8');
        
        const sql = rawSql.replace(/--.*$/gm, '');
        
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        console.log(`[Optimize] Executing ${statements.length} optimization statements...`);
        
        for (const statement of statements) {
            try {
                await pool.query(statement);
                console.log(`[Optimize] Success: ${statement.substring(0, 50)}...`);
            } catch (err) {
                console.error(`[Optimize] Error:`, err.message);
            }
        }
        
        console.log('[Optimize] Database optimization complete.');
    } catch (err) {
        console.error('[Optimize] Fatal error:', err);
    } finally {
        await pool.end();
    }
}

run();
