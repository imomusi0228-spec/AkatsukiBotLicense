// filename: scripts/run-init-sql.js
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
        const sqlPath = path.join(__dirname, '../sql/init.sql');
        const rawSql = fs.readFileSync(sqlPath, 'utf8');
        
        // コメントを除去
        const sql = rawSql.replace(/--.*$/gm, '');
        
        // セミコロンで分割
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        console.log(`[Setup] Executing ${statements.length} SQL statements...`);
        
        for (const statement of statements) {
            try {
                await pool.query(statement);
            } catch (err) {
                // IF NOT EXISTSなどでスキップされる場合は警告程度に
                if (err.code === '42P07' || err.code === '42710') {
                    console.warn(`[Setup] Skipping: Already exists`);
                } else {
                    console.error(`[Setup] Error in statement: ${statement.substring(0, 50)}...`, err.message);
                    throw err;
                }
            }
        }
        
        console.log('[Setup] Database initialized successfully.');
    } catch (err) {
        console.error('[Setup] Fatal error initializing database:', err);
    } finally {
        await pool.end();
    }
}

run();
