const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        await client.connect();
        console.log('Connected to DB. Starting migration...');

        // Add user_avatar and user_handle columns to subscriptions if they don't exist
        await client.query(`
            ALTER TABLE subscriptions 
            ADD COLUMN IF NOT EXISTS user_avatar TEXT,
            ADD COLUMN IF NOT EXISTS user_handle TEXT;
        `);
        console.log('Subscriptions table updated.');

        // Add updated_at if missing
        await client.query(`
            ALTER TABLE subscriptions 
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
        `);

        // Check staff_permissions table
        await client.query(`
            ALTER TABLE staff_permissions
            ADD COLUMN IF NOT EXISTS discord_tag TEXT;
        `);

        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await client.end();
    }
}

migrate();
