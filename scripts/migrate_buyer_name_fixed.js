const db = require('../src/config/database');

async function run() {
    try {
        console.log('Adding buyer_name to orders table...');
        await db.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='buyer_name') THEN
                    ALTER TABLE orders ADD COLUMN buyer_name TEXT;
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
