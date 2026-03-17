const db = require('../src/config/database');

async function run() {
    try {
        console.log('Checking and adding missing columns to orders table...');
        
        const columnsToAdd = [
            { name: 'used', type: 'BOOLEAN DEFAULT FALSE' },
            { name: 'used_by_discord_id', type: 'TEXT' },
            { name: 'used_at', type: 'TIMESTAMP' }
        ];

        for (const col of columnsToAdd) {
            await db.query(`
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='${col.name}') THEN
                        ALTER TABLE orders ADD COLUMN ${col.name} ${col.type};
                    END IF;
                END $$;
            `);
            console.log(`Column ${col.name} checked/added.`);
        }

        console.log('Success!');
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

run();
