require('dotenv').config();
const db = require('../db');

async function migrate() {
    console.log('[Migration] Adding last_warning_days to subscriptions...');
    try {
        await db.query(`
            ALTER TABLE subscriptions 
            ADD COLUMN IF NOT EXISTS last_warning_days INTEGER DEFAULT NULL
        `);
        console.log('[Migration] Successfully added last_warning_days.');
    } catch (err) {
        if (err.code === '42701') {
            console.log('[Migration] Column last_warning_days already exists.');
        } else {
            console.error('[Migration] Failed to add column:', err);
        }
    }
    process.exit(0);
}

migrate();
