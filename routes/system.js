const express = require('express');
const router = express.Router();
const os = require('os');
const db = require('../db');
const { authMiddleware } = require('./middleware');

let lastCpuUsage = process.cpuUsage();
let lastCpuTime = process.hrtime();

// GET /api/system/status - Detailed System & Bot Health
router.get('/status', authMiddleware, async (req, res) => {
    const client = req.app.discordClient;
    
    // CPU Load for the Bot Process (Process-specific)
    const currentCpuUsage = process.cpuUsage(lastCpuUsage);
    const currentCpuTime = process.hrtime(lastCpuTime);
    
    const elapsedMicros = currentCpuTime[0] * 1e6 + currentCpuTime[1] / 1e3;
    const cpuUserPercent = (currentCpuUsage.user / elapsedMicros) * 100;
    const cpuSystemPercent = (currentCpuUsage.system / elapsedMicros) * 100;
    const botCpuPercent = ((cpuUserPercent + cpuSystemPercent) / os.cpus().length).toFixed(2);

    // Update markers for next call
    lastCpuUsage = process.cpuUsage();
    lastCpuTime = process.hrtime();
    
    // Memory Status (Process-specific RSS)
    const memUsage = process.memoryUsage();
    const rssMB = (memUsage.rss / (1024 * 1024)).toFixed(2);
    const totalMem = os.totalmem();
    const memPercent = ((memUsage.rss / totalMem) * 100).toFixed(2);

    res.json({
        bot: {
            status: client ? 'online' : 'offline',
            latency: client ? client.ws.ping : -1,
            uptime: process.uptime(),
            guilds: client ? client.guilds.cache.size : 0,
            users: client ? client.users.cache.size : 0
        },
        system: {
            platform: os.platform(),
            release: os.release(),
            uptime: os.uptime(),
            load: botCpuPercent, // Bot CPU usage
            memory: {
                total: (totalMem / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
                used: (memUsage.rss / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
                free: ((totalMem - memUsage.rss) / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
                percent: memPercent + '%'
            },
            cpuCount: os.cpus().length,
            cpuModel: os.cpus()[0].model
        },
        timestamp: new Date()
    });
});

// POST /api/system/backup - Trigger DB Backup
router.post('/backup', authMiddleware, async (req, res) => {
    // Only allow admin
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    try {
        const { exec } = require('child_process');
        const path = require('path');
        const fs = require('fs');

        const backupDir = path.join(__dirname, '../backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);

        const fileName = `db_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
        const filePath = path.join(backupDir, fileName);

        // Note: This expects pg_dump to be in PATH or connection string in environment
        // For simplicity and since we are on Windows, we might fallback to JSON dump if pg_dump fails
        const dbUrl = process.env.DATABASE_URL;
        
        // Try pg_dump first (if it exists)
        exec(`pg_dump "${dbUrl}" > "${filePath}"`, async (error, stdout, stderr) => {
            if (error) {
                console.error('[Backup] pg_dump failed, falling back to JSON dump:', error.message);
                
                // Fallback: JSON Dump (same as previous implementation)
                try {
                    const tables = ['subscriptions', 'applications', 'blacklist', 'scheduled_announcements', 'operation_logs'];
                    const backup = {};
                    for (const table of tables) {
                        const result = await db.query(`SELECT * FROM ${table}`);
                        backup[table] = result.rows;
                    }
                    const jsonFileName = fileName.replace('.sql', '.json');
                    const jsonFilePath = filePath.replace('.sql', '.json');
                    fs.writeFileSync(jsonFilePath, JSON.stringify(backup, null, 2));
                    return res.json({ success: true, fileName: jsonFileName, type: 'json_fallback', message: 'Backup created (JSON fallback)' });
                } catch (fallbackErr) {
                    return res.status(500).json({ error: 'Manual backup failed: ' + fallbackErr.message });
                }
            }
            
            res.json({ success: true, fileName, type: 'sql', message: 'Backup created successfully (SQL)' });
        });
    } catch (err) {
        console.error('[Backup] Fatal error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
