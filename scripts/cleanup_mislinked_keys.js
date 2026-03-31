const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    console.log('--- Database Cleanup Started ---');
    try {
        // 1. Identify all keys with 'Generated for App' or 'App ID:' that are wrongly linked
        // We set them to NULL because they are system-controlled keys
        const q1 = "UPDATE license_keys SET used_by_user = NULL, reserved_user_id = NULL WHERE notes LIKE '%Generated for App%' OR notes LIKE '%App ID:%'";
        const r1 = await pool.query(q1);
        console.log(`[LicenseKeys] Cleared owner for ${r1.rowCount} system-generated keys.`);

        // 2. Potentially sync other mislinked applications
        // (Any applications where author_id != parsed_user_id and it's not a generic admin action)
        // For now, Baroness's request was mainly about the ones showing for HER.
        
        console.log('--- Database Cleanup Finished ---');
    } catch (err) {
        console.error('Cleanup error:', err);
    } finally {
        await pool.end();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
