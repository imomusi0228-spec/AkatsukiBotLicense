const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('./middleware');

// GET /api/portal/me
router.get('/me', authMiddleware, async (req, res) => {
    res.json({
        authenticated: true,
        user: req.user
    });
});

// GET /api/portal/licenses
router.get('/licenses', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        const result = await db.query('SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY updated_at DESC', [userId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/portal/licenses/:guildId/toggle (S-2)
router.post('/licenses/:guildId/toggle', authMiddleware, async (req, res) => {
    const { guildId } = req.params;
    const { action } = req.body; // 'pause' or 'resume'
    const userId = req.user.userId;
    const username = req.user.username;

    try {
        const subRes = await db.query('SELECT * FROM subscriptions WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
        if (subRes.rows.length === 0) return res.status(404).json({ error: 'Subscription not found or not yours' });
        const sub = subRes.rows[0];

        if (action === 'pause') {
            if (sub.paused_at) return res.status(400).json({ error: 'Already paused' });
            if (sub.tier === 'Free') return res.status(400).json({ error: 'Cannot pause Free tier' });

            await db.query(`
                UPDATE subscriptions 
                SET paused_at = NOW(), paused_tier = tier, tier = 'Free', is_active = FALSE, updated_at = NOW() 
                WHERE guild_id = $1
            `, [guildId]);

            // Log
            await db.query('INSERT INTO operation_logs (operator_id, operator_name, target_id, target_name, action_type, details) VALUES ($1, $2, $3, $4, $5, $6)',
                [userId, username, guildId, sub.cached_servername || guildId, 'USER_PAUSE', `User paused ${sub.tier}`]);

        } else if (action === 'resume') {
            if (!sub.paused_at) return res.status(400).json({ error: 'Not paused' });

            let newExpiry = sub.expiry_date ? new Date(sub.expiry_date) : null;
            if (newExpiry) {
                const pausedMs = Date.now() - new Date(sub.paused_at).getTime();
                newExpiry = new Date(newExpiry.getTime() + pausedMs);
            }

            const restoredTier = sub.paused_tier || 'Pro';
            await db.query(`
                UPDATE subscriptions 
                SET paused_at = NULL, paused_tier = NULL, tier = $1, expiry_date = $2, is_active = TRUE, updated_at = NOW() 
                WHERE guild_id = $3
            `, [restoredTier, newExpiry, guildId]);

            // Log
            await db.query('INSERT INTO operation_logs (operator_id, operator_name, target_id, target_name, action_type, details) VALUES ($1, $2, $3, $4, $5, $6)',
                [userId, username, guildId, sub.cached_servername || guildId, 'USER_RESUME', `User resumed ${restoredTier}`]);
        } else {
            return res.status(400).json({ error: 'Invalid action' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
