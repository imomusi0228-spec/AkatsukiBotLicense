const db = require('../db');

async function migrate() {
    console.log('[Migration] Adding ip_address column to user_sessions and operation_logs...');
    try {
        await db.query(`
            ALTER TABLE user_sessions 
            ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45)
        `);
        console.log('[Migration] Added ip_address to user_sessions');

        await db.query(`
            ALTER TABLE operation_logs 
            ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45)
        `);
        console.log('[Migration] Added ip_address to operation_logs');

        console.log('[Migration] Success!');
        process.exit(0);
    } catch (err) {
        console.error('[Migration] Failed:', err);
        process.exit(1);
    }
}

migrate();
