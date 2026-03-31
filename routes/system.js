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
        const { performBackup } = require('../services/backupService');
        const result = await performBackup();
        res.json(result);
    } catch (err) {
        console.error('[Backup] Fatal error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
