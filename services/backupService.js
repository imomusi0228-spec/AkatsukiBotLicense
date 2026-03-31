const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const db = require('../db');

/**
 * Perform a database backup.
 * Tries pg_dump first, falls back to a JSON dump of key tables.
 */
async function performBackup() {
    const backupDir = path.join(__dirname, '../backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `db_backup_${timestamp}.sql`;
    const filePath = path.join(backupDir, fileName);
    const dbUrl = process.env.DATABASE_URL;

    return new Promise((resolve, reject) => {
        // Try pg_dump first
        exec(`pg_dump "${dbUrl}" > "${filePath}"`, async (error, stdout, stderr) => {
            if (error) {
                console.error('[BackupService] pg_dump failed, falling back to JSON dump:', error.message);
                
                try {
                    const tables = [
                        'subscriptions', 
                        'applications', 
                        'blacklist', 
                        'scheduled_announcements', 
                        'operation_logs',
                        'bot_system_settings',
                        'license_keys'
                    ];
                    const backup = {};
                    for (const table of tables) {
                        const result = await db.query(`SELECT * FROM ${table}`);
                        backup[table] = result.rows;
                    }
                    
                    const jsonFileName = fileName.replace('.sql', '.json');
                    const jsonFilePath = filePath.replace('.sql', '.json');
                    fs.writeFileSync(jsonFilePath, JSON.stringify(backup, null, 2));
                    
                    // Clean up partial SQL file if it exists
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

                    resolve({
                        success: true,
                        fileName: jsonFileName,
                        type: 'json_fallback',
                        message: 'Backup created (JSON fallback)'
                    });
                } catch (fallbackErr) {
                    console.error('[BackupService] Fallback also failed:', fallbackErr);
                    reject(fallbackErr);
                }
                return;
            }
            
            resolve({
                success: true,
                fileName,
                type: 'sql',
                message: 'Backup created successfully (SQL)'
            });
        });
    });
}

/**
 * Clean up old backups (older than X days)
 */
async function cleanupOldBackups(days = 30) {
    const backupDir = path.join(__dirname, '../backups');
    if (!fs.existsSync(backupDir)) return;

    const files = fs.readdirSync(backupDir);
    const now = Date.now();
    const expiryMs = days * 24 * 60 * 60 * 1000;

    let count = 0;
    for (const file of files) {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > expiryMs) {
            fs.unlinkSync(filePath);
            count++;
        }
    }
    return count;
}

module.exports = {
    performBackup,
    cleanupOldBackups
};
