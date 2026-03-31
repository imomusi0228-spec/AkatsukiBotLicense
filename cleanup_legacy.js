const fs = require('fs');
const path = require('path');

const filesToDelete = [
    'index.js',
    'server.js',
    'sync.js',
    'db.js',
    'activate_server_check.js',
    'activate_server_final.js',
    'admin_remote.js',
    'api_remote.js',
    'announce_history.js',
    'check_db.js',
    'commands.js',
    'commands_server_check.js',
    'commands_server_final.js',
    'migrate_v2.js',
    'plans_server_check.js',
    'plans_server_final.js',
    'project.tar.gz',
    'project_final.tar.gz',
    'sync_history.js',
    'test_fetch.js',
    'tickets_remote.ejs',
    'db_schema_debug.json',
    'full_db_schema.json'
];

filesToDelete.forEach(file => {
    const fullPath = path.join(__dirname, file);
    if (fs.existsSync(fullPath)) {
        try {
            fs.unlinkSync(fullPath);
            console.log(`Deleted: ${file}`);
        } catch (e) {
            console.error(`Error deleting ${file}: ${e.message}`);
        }
    } else {
        console.log(`Not found: ${file}`);
    }
});
