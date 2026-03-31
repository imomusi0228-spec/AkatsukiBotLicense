const express = require('express');
const router = express.Router();
const db = require('../db');
const { updateMemberRoles } = require('../sync');
const { authMiddleware } = require('./middleware');
const { sendWebhookNotification } = require('../services/notif');

// GET /api/subscriptions
router.get('/', authMiddleware, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const page = parseInt(req.query.page) || 1;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';

        let queryText = 'SELECT * FROM subscriptions';
        let params = [];
        let whereClause = [];

        if (search) {
            whereClause.push('(guild_id ILIKE $1 OR user_id ILIKE $1 OR tier ILIKE $1 OR cached_username ILIKE $1 OR cached_servername ILIKE $1 OR user_handle ILIKE $1)');
            params.push(`%${search}%`);
        }

        if (whereClause.length > 0) {
            queryText += ' WHERE ' + whereClause.join(' AND ');
        }

        // Get total count for pagination
        const countRes = await db.query(queryText.replace('SELECT *', 'SELECT COUNT(*)'), params);
        const totalCount = parseInt(countRes.rows[0].count);

        queryText += ` ORDER BY expiry_date ASC NULLS LAST LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await db.query(queryText, params);
        const subs = result.rows;

        // Fetch names from Discord (Optimized: Use cache primarily, refresh in background)
        const client = req.app.discordClient;
        if (client) {
            const enrichedSubs = subs.map(sub => {
                const sId = sub.guild_id;
                const uId = sub.user_id;
                
                // 1. Initial values from DB cache
                let serverName = sub.cached_servername || sId;
                let userName = sub.cached_username || uId || 'Unknown User';
                let userAvatarHash = sub.user_avatar; // If we add this column to DB
                let userHandle = sub.user_handle;     // If we add this column to DB

                // 2. Background Refresh (Don't await)
                const refreshInBackground = async () => {
                    try {
                        let updated = false;
                        
                        // Server Name
                        if (sId && !sub.cached_servername) {
                            const guild = client.guilds.cache.get(sId) || await client.guilds.fetch(sId).catch(() => null);
                            if (guild) {
                                serverName = guild.name;
                                updated = true;
                            }
                        }

                        // User Info
                        if (uId) {
                            // Try cache first
                            let user = client.users.cache.get(uId);
                            
                            // If missing OR we want to force refresh sometimes, fetch it
                            if (!user || !sub.cached_username) {
                                user = await client.users.fetch(uId).catch(() => null);
                            }

                            if (user) {
                                const newName = user.globalName || user.username;
                                const newHandle = user.username;
                                const newAvatar = user.avatar;

                                if (newName !== sub.cached_username || newAvatar !== sub.user_avatar) {
                                    userName = newName;
                                    userHandle = newHandle;
                                    userAvatarHash = newAvatar;
                                    updated = true;
                                }
                            }
                        }

                        if (updated) {
                            // Update DB Cache
                            await db.query(`
                                UPDATE subscriptions 
                                SET cached_username = $1, 
                                    cached_servername = $2,
                                    user_avatar = $3,
                                    user_handle = $4,
                                    updated_at = NOW()
                                WHERE guild_id = $5 OR (user_id = $6 AND guild_id = $5)
                            `, [userName, serverName, userAvatarHash, userHandle, sId, uId]).catch(() => { });
                        }
                    } catch (e) {
                        console.error('[Refresh Cache Error]', e);
                    }
                };

                // Trigger background refresh without awaiting
                refreshInBackground();

                // Return what we have (cached)
                return { 
                    ...sub, 
                    server_name: serverName, 
                    user_display_name: userName, 
                    user_avatar: userAvatarHash, 
                    user_handle: userHandle 
                };
            });
            res.json({ data: enrichedSubs, pagination: { total: totalCount, page, limit, pages: Math.ceil(totalCount / limit) } });
        } else {
            res.json({ data: subs, pagination: { total: totalCount, page, limit, pages: Math.ceil(totalCount / limit) } });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/stats
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const stats = {
            paid_count: 0,
            total_count: 0,
            expiring_soon_count: 0,
            new_this_month: 0,
            renewed_this_month: 0
        };

        // Total Active Count (Unique Users)
        const totalRes = await db.query("SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE is_active = TRUE");
        stats.total_count = parseInt(totalRes.rows[0].count);

        // Paid Count (Unique Users with Pro/Pro+)
        const paidRes = await db.query("SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE is_active = TRUE AND tier IN ('Pro', 'Pro+', '1', '3')");
        stats.paid_count = parseInt(paidRes.rows[0].count);

        // Expiring Soon (within 7 days)
        const expiringRes = await db.query(`
            SELECT COUNT(*) FROM subscriptions 
            WHERE is_active = TRUE 
            AND tier != 'ULTIMATE'
            AND expiry_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        `);
        stats.expiring_soon_count = parseInt(expiringRes.rows[0].count);

        // New/Renewed This Month (Approximation using operation_logs or created_at if we had it)
        // Since we don't have created_at on subscriptions (we do, start_date), let's use start_date for new.
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const newRes = await db.query(`
            SELECT COUNT(*) FROM subscriptions 
            WHERE start_date >= $1
            AND tier != 'ULTIMATE'
        `, [startOfMonth]);
        stats.new_this_month = parseInt(newRes.rows[0].count);

        // Renewed (Log based)
        const renewedRes = await db.query(`
            SELECT COUNT(*) FROM operation_logs 
            WHERE action_type = 'EXTEND' 
            AND created_at >= $1
        `, [startOfMonth]);
        stats.renewed_this_month = parseInt(renewedRes.rows[0].count);

        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/subscriptions/stats/detailed
router.get('/stats/detailed', authMiddleware, async (req, res) => {
    try {
        const stats = {
            tier_distribution: {
                paid: {},
                trial: {},
                overall: {}
            },
            retention_rate: 0,
            growth_data: [],
            top_commands: []
        };

        // All active subscriptions for distribution (Unique Users per Tier)
        const activeRes = await db.query("SELECT tier, COUNT(DISTINCT user_id) as count FROM subscriptions WHERE is_active = TRUE GROUP BY tier");
        activeRes.rows.forEach(row => {
            const tier = row.tier;
            const count = parseInt(row.count);
            stats.tier_distribution.overall[tier] = count;

            if (tier === 'Pro' || tier === 'Pro+' || tier === '1' || tier === '3' || tier === 1 || tier === 3) {
                stats.tier_distribution.paid[tier] = count;
            } else if (String(tier).includes('Trial')) {
                stats.tier_distribution.trial[tier] = count;
            }
        });

        // Retention Rate (Unique Paid Users)
        const totalPaidRes = await db.query("SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE tier IN ('Pro', 'Pro+', '1', '3') AND tier != 'ULTIMATE'");
        const activePaidRes = await db.query("SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE is_active = TRUE AND tier IN ('Pro', 'Pro+', '1', '3') AND tier != 'ULTIMATE'");
        const totalPaid = parseInt(totalPaidRes.rows[0].count);
        const activePaid = parseInt(activePaidRes.rows[0].count);
        stats.retention_rate = totalPaid > 0 ? Math.round((activePaid / totalPaid) * 100) : 0;

        // Growth Data (Last 6 months)
        const growthRes = await db.query(`
            SELECT 
                TO_CHAR(COALESCE(start_date, created_at, NOW()), 'YYYY-MM') as month,
                COUNT(*) as count
            FROM subscriptions 
            WHERE is_active = TRUE
            AND COALESCE(start_date, created_at, NOW()) >= NOW() - INTERVAL '6 months'
            GROUP BY month
            ORDER BY month ASC
        `);
        stats.growth_data = growthRes.rows;

        // Daily Activity for Heatmap (Last 28 days)
        const activityRes = await db.query(`
            SELECT 
                TO_CHAR(created_at, 'YYYY-MM-DD') as day,
                COUNT(*) as count
            FROM operation_logs
            WHERE created_at >= NOW() - INTERVAL '28 days'
            GROUP BY day
            ORDER BY day ASC
        `);

        // Map to a 28-day array
        const activityMap = {};
        activityRes.rows.forEach(r => activityMap[r.day] = parseInt(r.count));

        const heatmapData = [];
        for (let i = 27; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            heatmapData.push({
                date: dateStr,
                count: activityMap[dateStr] || 0
            });
        }
        stats.heatmap_data = heatmapData;

        // Top Commands (Last 30 days)
        const commandRes = await db.query(`
            SELECT command_name, COUNT(*) as count 
            FROM command_usage_logs 
            WHERE created_at >= NOW() - INTERVAL '30 days'
            GROUP BY command_name 
            ORDER BY count DESC 
            LIMIT 10
        `);
        stats.top_commands = commandRes.rows;

        // --- Advanced Metrics ---
        // 1. Revenue Forecast (MRR Estimate)
        const revenueRes = await db.query(`
            SELECT SUM(
                CASE 
                    WHEN tier IN ('Pro', 'PRO', '1') THEN 500
                    WHEN tier IN ('Pro+', 'PRO_PLUS', '3') THEN 1000
                    ELSE 0
                END
            ) as mrr FROM subscriptions WHERE is_active = TRUE
        `);
        stats.mrr_estimate = parseInt(revenueRes.rows[0].mrr || 0);

        // 2. Churn Rate (approximation)
        const expired30dRes = await db.query("SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE expiry_date BETWEEN NOW() - INTERVAL '30 days' AND NOW() AND tier != 'Free'");
        const expiredCount = parseInt(expired30dRes.rows[0].count || 0);
        stats.churn_rate = stats.total_active > 0 ? Math.round((expiredCount / (stats.total_active + expiredCount)) * 100) : 0;

        // 3. Growth Trends
        const lastMonthRes = await db.query("SELECT COUNT(*) FROM subscriptions WHERE created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days'");
        const thisMonthRes = await db.query("SELECT COUNT(*) FROM subscriptions WHERE created_at >= NOW() - INTERVAL '30 days'");
        const lastMonthCount = parseInt(lastMonthRes.rows[0].count || 0);
        const thisMonthCount = parseInt(thisMonthRes.rows[0].count || 0);
        stats.growth_rate = lastMonthCount > 0 ? Math.round(((thisMonthCount - lastMonthCount) / lastMonthCount) * 100) : 0;

        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/subscriptions/analytics/members/:guildId
router.get('/analytics/members/:guildId', authMiddleware, async (req, res) => {
    const { guildId } = req.params;
    try {
        const result = await db.query(`
            SELECT captured_at as date, member_count 
            FROM guild_member_snapshots 
            WHERE guild_id = $1 
            ORDER BY captured_at ASC 
            LIMIT 30
        `, [guildId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/subscriptions/:id/auto-renew
router.patch('/:id/auto-renew', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { enabled } = req.body;
    try {
        await db.query('UPDATE subscriptions SET auto_renew = $1 WHERE guild_id = $2', [enabled, id]);

        // Fetch sub info for logging/notification
        const subRes = await db.query('SELECT cached_servername FROM subscriptions WHERE guild_id = $1', [id]);
        const serverName = (subRes.rows[0]?.cached_servername) || id;

        // Log
        const operatorId = req.user?.userId || 'Unknown';
        const operatorName = req.user?.username || 'Unknown';
        await db.query(`INSERT INTO operation_logs (operator_id, operator_name, target_id, target_name, action_type, details, metadata) VALUES ($1, $2, $3, $4, 'TOGGLE_AUTO_RENEW', $5, $6)`,
            [operatorId, operatorName, id, serverName, `Set auto_renew to ${enabled}`, JSON.stringify({ enabled })]);

        // Notify
        await sendWebhookNotification({
            title: 'Auto-Renew Toggled',
            description: `**Server:** ${serverName} (\`${id}\`)\n**Status:** ${enabled ? 'Enabled' : 'Disabled'}`,
            color: enabled ? 0x2ecc71 : 0xe74c3c,
            fields: [{ name: 'Operator', value: operatorName, inline: true }]
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/logs (Self History)
router.get('/logs', authMiddleware, async (req, res) => {
    try {
        // Return logs where operator is this user OR system logs
        // Since it's a personal tool, maybe just show last 50 logs?
        const limit = 50;
        const result = await db.query(`
            SELECT * FROM operation_logs 
            ORDER BY created_at DESC 
            LIMIT $1
        `, [limit]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// POST /api/subscriptions
router.post('/', authMiddleware, async (req, res) => {
    const { guild_id, user_id, tier, duration } = req.body;
    if (!guild_id || !user_id || !tier) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        let expiryDate = null;
        const now = new Date();

        if (duration) {
            const match = String(duration).match(/^(\d+)([dmy])$/);
            if (match) {
                const amount = parseInt(match[1]);
                const unit = match[2];
                if (unit === 'd') now.setDate(now.getDate() + amount);
                else if (unit === 'm') now.setMonth(now.getMonth() + amount);
                else if (unit === 'y') now.setFullYear(now.getFullYear() + amount);
                expiryDate = now;
            } else if (/^\d+$/.test(String(duration))) {
                now.setMonth(now.getMonth() + parseInt(duration));
                expiryDate = now;
            }
        }

        // Default to 1 month if no expiry set and it's a paid tier
        if (!expiryDate && tier !== 'Free') {
            const defaultDate = new Date();
            defaultDate.setMonth(defaultDate.getMonth() + 1);
            expiryDate = defaultDate;
        }

        await db.query(
            'INSERT INTO subscriptions (guild_id, user_id, tier, expiry_date, is_active, expiry_warning_sent) VALUES ($1, $2, $3, $4, TRUE, FALSE) ON CONFLICT (guild_id) DO UPDATE SET user_id = EXCLUDED.user_id, tier = EXCLUDED.tier, expiry_date = EXCLUDED.expiry_date, is_active = TRUE, expiry_warning_sent = FALSE',
            [guild_id, user_id, tier, expiryDate]
        );

        // Fetch server name if possible for logging
        let serverName = guild_id;
        const client = req.app.discordClient;
        if (client) {
            const guild = client.guilds.cache.get(guild_id) || await client.guilds.fetch(guild_id).catch(() => null);
            if (guild) serverName = guild.name;
        }

        // Log
        const operatorId = req.user?.userId || 'Unknown';
        const operatorName = req.user?.username || 'Unknown';
        await db.query(`
            INSERT INTO operation_logs (operator_id, operator_name, target_id, target_name, action_type, details, metadata, ip_address)
            VALUES ($1, $2, $3, $4, 'CREATE', $5, $6, $7)
        `, [operatorId, operatorName, guild_id, serverName, `Created ${tier} for ${duration || 'unspecified'}`, JSON.stringify({ tier, duration, expiryDate }), req.user.ipAddress]);

        // Notify
        await sendWebhookNotification({
            title: '【ライセンス】作成/更新',
            description: `**サーバー:** ${serverName} (\`${guild_id}\`)\n**ティア:** ${tier}\n**期間:** ${duration || 'unspecified'}`,
            color: 0x3498db,
            fields: [
                { name: 'User ID', value: user_id, inline: true },
                { name: 'Operator', value: operatorName, inline: true }
            ]
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/subscriptions/:id
router.put('/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { action, duration, tier, notes, is_active } = req.body;
    const client = req.app.discordClient;
    const SUPPORT_GUILD_ID = process.env.SUPPORT_GUILD_ID;

    try {
        const operatorId = req.user?.userId || 'Unknown';
        const operatorName = req.user?.username || 'Unknown';

        if (action === 'extend') {
            const currentSub = await db.query('SELECT user_id, expiry_date, tier, cached_servername FROM subscriptions WHERE guild_id = $1', [id]);
            if (currentSub.rows.length === 0) return res.status(404).json({ error: 'Not found' });

            const subData = currentSub.rows[0];
            const serverName = subData.cached_servername || id;
            let currentExpiry = subData.expiry_date ? new Date(subData.expiry_date) : new Date();
            if (currentExpiry < new Date()) currentExpiry = new Date();

            const match = String(duration).match(/^(-?\d+)([dmy])$/);
            let amount, unit;

            if (match) {
                amount = parseInt(match[1]);
                unit = match[2];
            } else if (/^\d+$/.test(duration)) {
                amount = parseInt(duration);
                unit = 'm';
            } else {
                return res.status(400).json({ error: 'Invalid duration format (expected e.g. 1m, 1d)' });
            }

            if (unit === 'd') currentExpiry.setDate(currentExpiry.getDate() + amount);
            else if (unit === 'm') currentExpiry.setMonth(currentExpiry.getMonth() + amount);
            else if (unit === 'y') currentExpiry.setFullYear(currentExpiry.getFullYear() + amount);

            // CRITICAL SYNC: Update ALL servers for this user
            await db.query('UPDATE subscriptions SET expiry_date = $1, is_active = TRUE, expiry_warning_sent = FALSE WHERE user_id = $2', [currentExpiry, subData.user_id]);

            // Log
            await db.query(`INSERT INTO operation_logs (operator_id, operator_name, target_id, target_name, action_type, details, metadata) VALUES ($1, $2, $3, $4, 'EXTEND', $5, $6)`,
                [operatorId, operatorName, id, serverName, `Extended by ${duration}`, JSON.stringify({ duration, newExpiry: currentExpiry })]);

            // Notify
            await sendWebhookNotification({
                title: 'License Extended',
                description: `**Server:** ${serverName} (\`${id}\`)\n**Extension:** ${duration}\n**New Expiry:** ${currentExpiry.toLocaleDateString()}`,
                color: 0x2ecc71,
                fields: [{ name: 'Operator', value: operatorName, inline: true }]
            });

            if (client && SUPPORT_GUILD_ID) {
                const guild = await client.guilds.fetch(SUPPORT_GUILD_ID).catch(() => null);
                if (guild) await updateMemberRoles(guild, subData.user_id, subData.tier);
            }

        } else if (action === 'update_tier') {
            const currentSub = await db.query('SELECT user_id, cached_servername, tier FROM subscriptions WHERE guild_id = $1', [id]);
            if (currentSub.rows.length === 0) return res.status(404).json({ error: 'Not found' });

            const subData = currentSub.rows[0];
            const userId = subData.user_id;
            const serverName = subData.cached_servername || id;
            const oldTier = subData.tier;

            // Update ALL servers for this user based on tier
            let expiryUpdateSql = '';
            if (tier === 'ULTIMATE') {
                // If upgrading to ULTIMATE, clear expiry
                expiryUpdateSql = ', expiry_date = NULL';
            } else if (oldTier === 'ULTIMATE') {
                // If downgrading from ULTIMATE, set a fallback expiry so it's not infinite
                expiryUpdateSql = ", expiry_date = NOW() + INTERVAL '1 month'";
            } // Otherwise maintain existing expiry dates

            await db.query(`UPDATE subscriptions SET tier = $1 ${expiryUpdateSql} WHERE user_id = $2`, [tier, userId]);

            // Log for the target user (applying to all their servers)
            await db.query(`INSERT INTO operation_logs (operator_id, operator_name, target_id, target_name, action_type, details, metadata) VALUES ($1, $2, $3, $4, 'UPDATE_TIER', $5, $6)`,
                [operatorId, operatorName, userId, serverName, `Changed User Tier to ${tier}`, JSON.stringify({ oldTier, newTier: tier, applied_to_all: true })]);

            // Notify
            await sendWebhookNotification({
                title: 'Tier Updated',
                description: `**Server:** ${serverName} (\`${id}\`)\n**Old Tier:** ${oldTier}\n**New Tier:** ${tier}`,
                color: 0xf1c40f,
                fields: [{ name: 'Operator', value: operatorName, inline: true }]
            });

            if (client && SUPPORT_GUILD_ID) {
                const guild = await client.guilds.fetch(SUPPORT_GUILD_ID).catch(() => null);
                if (guild) await updateMemberRoles(guild, subData.user_id, tier);
            }
        } else if (action === 'toggle_active') {
            const currentSub = await db.query('SELECT user_id, cached_servername, tier, paused_at, paused_tier, expiry_date FROM subscriptions WHERE guild_id = $1', [id]);
            if (currentSub.rows.length === 0) return res.status(404).json({ error: 'Not found' });
            const subData = currentSub.rows[0];
            const userId = subData.user_id;
            const serverName = subData.cached_servername || id;

            if (!is_active) {
                // 【停止処理】当該ユーザーの全サーバーを一括停止
                if (subData.paused_at) {
                    return res.status(400).json({ error: 'Already paused' });
                }
                await db.query(`
                    UPDATE subscriptions
                    SET is_active = FALSE, paused_at = NOW(), paused_tier = tier, tier = 'Free', updated_at = NOW()
                    WHERE user_id = $1
                `, [userId]);
            } else {
                // 【再開処理】当該ユーザーの全サーバーを一括再開
                let newExpiry = subData.expiry_date ? new Date(subData.expiry_date) : null;
                if (subData.paused_at && newExpiry) {
                    const pausedMs = Date.now() - new Date(subData.paused_at).getTime();
                    newExpiry = new Date(newExpiry.getTime() + pausedMs);
                }
                const restoredTier = subData.paused_tier || subData.tier;

                await db.query(`
                    UPDATE subscriptions
                    SET is_active = TRUE, paused_at = NULL, paused_tier = NULL, tier = $1, expiry_date = $2, updated_at = NOW()
                    WHERE user_id = $3
                `, [restoredTier, newExpiry, userId]);
            }

            // Log
            await db.query(`INSERT INTO operation_logs (operator_id, operator_name, target_id, target_name, action_type, details, metadata) VALUES ($1, $2, $3, $4, 'TOGGLE_ACTIVE', $5, $6)`,
                [operatorId, operatorName, id, serverName, `Set active to ${is_active}`, JSON.stringify({ is_active })]);

            // Notify
            await sendWebhookNotification({
                title: is_active ? 'License Resumed' : 'License Suspended',
                description: `**Server:** ${serverName} (\`${id}\`)${!is_active ? '\n*一時停止中: Free扱いに降格。再開時に期限を自動延長します。*' : '\n*再開済: 元プランを復元し、停止期間分の期限を延長しました。*'}`,
                color: is_active ? 0x2ecc71 : 0xe67e22,
                fields: [{ name: 'Operator', value: operatorName, inline: true }]
            });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/subscriptions/:id
router.delete('/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const subRes = await db.query('SELECT cached_servername FROM subscriptions WHERE guild_id = $1', [id]);
        const serverName = subRes.rows[0]?.cached_servername || id;

        await db.query('UPDATE subscriptions SET is_active = FALSE WHERE guild_id = $2', [id]);

        // Log
        const operatorId = req.user?.userId || 'Unknown';
        const operatorName = req.user?.username || 'Unknown';
        await db.query(`INSERT INTO operation_logs (operator_id, operator_name, target_id, target_name, action_type, details, ip_address) VALUES ($1, $2, $3, $4, 'DEACTIVATE', 'Soft Delete', $5)`,
            [operatorId, operatorName, id, serverName, req.user.ipAddress]);

        // Notify
        await sendWebhookNotification({
            title: '【ライセンス】一時停止済み',
            description: `**サーバー:** ${serverName} (\`${id}\`)\n*ソフトデリートによりライセンスが停止されました。*`,
            color: 0xe74c3c,
            fields: [{ name: 'Operator', value: operatorName, inline: true }]
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/subscriptions/:id/delete - Complete deletion
router.delete('/:id/delete', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const subRes = await db.query('SELECT cached_servername FROM subscriptions WHERE guild_id = $1', [id]);
        const serverName = subRes.rows[0]?.cached_servername || id;

        await db.query('DELETE FROM subscriptions WHERE guild_id = $1', [id]);

        // Log
        const operatorId = req.user?.userId || 'Unknown';
        const operatorName = req.user?.username || 'Unknown';
        await db.query(`INSERT INTO operation_logs (operator_id, operator_name, target_id, target_name, action_type, details, ip_address) VALUES ($1, $2, $3, $4, 'DELETE', 'Hard Delete', $5)`,
            [operatorId, operatorName, id, serverName, req.user.ipAddress]);

        // Notify
        await sendWebhookNotification({
            title: '【ライセンス】完全削除済み',
            description: `**サーバー:** ${serverName} (\`${id}\`)\n*データベースからデータが完全に削除されました。*`,
            color: 0x2c3e50,
            fields: [{ name: 'Operator', value: operatorName, inline: true }]
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/subscriptions/user/:userId/servers
router.get('/user/:userId/servers', authMiddleware, async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await db.query('SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY expiry_date ASC', [userId]);
        const subs = result.rows;

        const client = req.app.discordClient;
        if (client) {
            const enrichedSubs = await Promise.all(subs.map(async sub => {
                const sId = sub.guild_id;
                let serverName = sub.cached_servername || sId;
                try {
                    if (sId && !sub.cached_servername) {
                        const guild = client.guilds.cache.get(sId) || await client.guilds.fetch(sId).catch(() => null);
                        if (guild) serverName = guild.name;
                    }
                } catch (e) { }
                return { ...sub, server_name: serverName };
            }));
            res.json(enrichedSubs);
        } else {
            res.json(subs);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
