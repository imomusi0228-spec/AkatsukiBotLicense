const db = require('../db');

async function migrate() {
    console.log('--- Migration Start ---');
    try {
        console.log('Adding buyer_name column...');
        await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_name TEXT');
        
        console.log('Adding gift_recipient column...');
        await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_recipient TEXT');
        
        console.log('--- Migration Completed Successfully ---');
    } catch (err) {
        console.error('--- Migration Failed ---');
        console.error(err);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

migrate();
