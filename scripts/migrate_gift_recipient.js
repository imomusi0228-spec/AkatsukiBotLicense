const db = require('../src/config/database');

async function run() {
    try {
        console.log('Adding gift_recipient to orders table...');
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='gift_recipient') THEN
                    ALTER TABLE orders ADD COLUMN gift_recipient TEXT;
                END IF;
            END $$;
        `);
        console.log('Success!');
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

run();
