const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('./middleware');
const { approveApplication } = require('../services/applicationService');

// Get all applications with pagination
router.get('/', authMiddleware, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const page = parseInt(req.query.page) || 1;
        const offset = (page - 1) * limit;

        // Get total count
        const countRes = await db.query('SELECT COUNT(*) FROM applications');
        const totalCount = parseInt(countRes.rows[0].count);

        const result = await db.query(`
            SELECT a.*, l.is_used 
            FROM applications a 
            LEFT JOIN license_keys l ON a.license_key = l.key_id 
            ORDER BY a.created_at DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        const apps = result.rows;

        // Fetch names from Discord
        const client = req.app.discordClient;
        if (client) {
            const enrichedApps = await Promise.all(apps.map(async app => {
                let userName = app.author_name || 'Unknown';
                let userHandle = 'unknown';
                let userAvatar = null;

                try {
                    // Cache-first lookup
                    const user = client.users.cache.get(app.author_id) || await client.users.fetch(app.author_id).catch(() => null);
                    if (user) {
                        userName = user.globalName || user.username;
                        userHandle = user.username;
                        userAvatar = user.avatar;
                    }
                } catch (e) {
                    console.warn(`[App Enrichment] Failed for user ${app.author_id}: ${e.message}`);
                }

                return {
                    ...app,
                    user_display_name: userName,
                    user_handle: userHandle,
                    user_avatar: userAvatar
                };
            }));
            res.json({
                data: enrichedApps,
                pagination: {
                    total: totalCount,
                    page,
                    limit,
                    pages: Math.ceil(totalCount / limit)
                }
            });
        } else {
            res.json({
                data: apps,
                pagination: {
                    total: totalCount,
                    page,
                    limit,
                    pages: Math.ceil(totalCount / limit)
                }
            });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Approve application and GENERATE KEY
router.post('/:id/approve', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const operatorId = req.user?.userId || 'Unknown';
        const operatorName = req.user?.username || 'Unknown';
        const isAdmin = req.user?.role === 'admin';

        // Security Alert for non-admin manual approval
        if (!isAdmin && operatorId !== 'SYSTEM_AUTO') {
            const dashboardUrl = `${process.env.PUBLIC_URL || ''}/#apps`;
            const { sendWebhookNotification } = require('../services/notif');
            await sendWebhookNotification({
                title: '⚠️ 【非管理者操作】承認実行',
                description: `管理権限のないユーザーが承認操作を実行しました。\n**担当者:** ${operatorName} (\`${operatorId}\`)\n**対象ID:** \`${id}\`\n\n[管理画面を見る](${dashboardUrl})`,
                color: 0xffa500
            });
        }

        const client = req.app.discordClient;
        const result = await approveApplication(id, operatorId, operatorName, false, client);
        res.json(result);
    } catch (err) {
        console.error(err);
        if (err.message === 'Application not found') return res.status(404).json({ error: 'Not found' });
        res.status(500).json({ error: 'Database error' });
    }
});

// Reject application
router.post('/:id/reject', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const appRes = await db.query('SELECT author_name, author_id, parsed_booth_name FROM applications WHERE id = $1', [id]);
        if (appRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const app = appRes.rows[0];

        await db.query('UPDATE applications SET status = \'rejected\' WHERE id = $1', [id]);

        // Log
        const operatorId = req.user?.userId || 'Unknown';
        const operatorName = req.user?.username || 'Unknown';
        const targetDesc = `${app.author_name} (${app.parsed_booth_name})`;
        await db.query(`
            INSERT INTO operation_logs (operator_id, operator_name, target_id, target_name, action_type, details)
            VALUES ($1, $2, $3, $4, 'REJECT_APP', 'Rejected application')
        `, [operatorId, operatorName, id, targetDesc]);

        // Notify
        const isAdmin = req.user?.role === 'admin';
        const dashboardUrl = `${process.env.PUBLIC_URL || ''}/#apps`;
        await sendWebhookNotification({
            title: isAdmin ? '🚫 【不受理】いたしました' : '⚠️ 【非管理者操作】不受理',
            description: `**対象者:** ${app.author_name} (\`${app.author_id}\`)\n**Booth:** ${app.parsed_booth_name}\n\n[管理画面を見る](${dashboardUrl})`,
            color: isAdmin ? 0xe74c3c : 0xffa500,
            fields: [{ name: '担当者', value: operatorName, inline: true }]
        });

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Hold application (New)
router.post('/:id/hold', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const appRes = await db.query('SELECT author_name, author_id, parsed_booth_name FROM applications WHERE id = $1', [id]);
        if (appRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const app = appRes.rows[0];

        await db.query('UPDATE applications SET status = \'on_hold\' WHERE id = $1', [id]);

        // Log
        const operatorId = req.user?.userId || 'Unknown';
        const operatorName = req.user?.username || 'Unknown';
        const targetDesc = `${app.author_name} (${app.parsed_booth_name})`;
        await db.query(`
            INSERT INTO operation_logs (operator_id, operator_name, target_id, target_name, action_type, details)
            VALUES ($1, $2, $3, $4, 'HOLD_APP', 'Put application on hold')
        `, [operatorId, operatorName, id, targetDesc]);

        // Notify
        const isAdmin = req.user?.role === 'admin';
        const dashboardUrl = `${process.env.PUBLIC_URL || ''}/#apps`;
        await sendWebhookNotification({
            title: isAdmin ? '⏳ 【保留】にいたしました' : '⚠️ 【非管理者操作】保留',
            description: `**対象者:** ${app.author_name} (\`${app.author_id}\`)\n**Booth:** ${app.parsed_booth_name}\n\n[管理画面を見る](${dashboardUrl})`,
            color: isAdmin ? 0xf1c40f : 0xffa500,
            fields: [{ name: '担当者', value: operatorName, inline: true }]
        });

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Cancel approved application
router.post('/:id/cancel', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const appRes = await db.query('SELECT author_name, author_id, parsed_booth_name FROM applications WHERE id = $1', [id]);
        if (appRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const app = appRes.rows[0];

        await db.query('UPDATE applications SET status = \'cancelled\' WHERE id = $1', [id]);

        // Log
        const operatorId = req.user?.userId || 'Unknown';
        const operatorName = req.user?.username || 'Unknown';
        const targetDesc = `${app.author_name} (${app.parsed_booth_name})`;
        await db.query(`
            INSERT INTO operation_logs (operator_id, operator_name, target_id, target_name, action_type, details)
            VALUES ($1, $2, $3, $4, 'CANCEL_APP', 'Cancelled approved application')
        `, [operatorId, operatorName, id, targetDesc]);

        // Notify
        const isAdmin = req.user?.role === 'admin';
        const dashboardUrl = `${process.env.PUBLIC_URL || ''}/#apps`;
        await sendWebhookNotification({
            title: isAdmin ? '✖️ 【取消】いたしました' : '⚠️ 【非管理者操作】取消',
            description: `**対象者:** ${app.author_name} (\`${app.author_id}\`)\n**Booth:** ${app.parsed_booth_name}\n\n[管理画面を見る](${dashboardUrl})`,
            color: isAdmin ? 0x95a5a6 : 0xffa500,
            fields: [{ name: '担当者', value: operatorName, inline: true }]
        });

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete application record
router.delete('/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const appRes = await db.query('SELECT author_name, author_id, parsed_booth_name FROM applications WHERE id = $1', [id]);
        if (appRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const app = appRes.rows[0];

        await db.query('DELETE FROM applications WHERE id = $1', [id]);

        // Log
        const operatorId = req.user?.userId || 'Unknown';
        const operatorName = req.user?.username || 'Unknown';
        const isAdmin = req.user?.role === 'admin';

        // Security Alert for non-admin delete
        if (!isAdmin) {
            const dashboardUrl = `${process.env.PUBLIC_URL || ''}/#apps`;
            await require('../services/notif').sendWebhookNotification({
                title: '⚠️ 【非管理者操作】レコード削除',
                description: `管理権限のないユーザーが申請レコードの削除を実行しました。\n**担当者:** ${operatorName} (\`${operatorId}\`)\n**対象者:** ${app.author_name}\n\n[管理画面を見る](${dashboardUrl})`,
                color: 0xffa500
            });
        }

        const targetDesc = `${app.author_name} (${app.parsed_booth_name})`;
        await db.query(`
            INSERT INTO operation_logs (operator_id, operator_name, target_id, target_name, action_type, details)
            VALUES ($1, $2, $3, $4, 'DELETE_APP', 'Deleted application record')
        `, [operatorId, operatorName, id, targetDesc]);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Reissue key (A-1)
router.post('/:id/reissue', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const appRes = await db.query('SELECT author_name, author_id, parsed_booth_name, license_key, parsed_tier FROM applications WHERE id = $1', [id]);
        if (appRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const app = appRes.rows[0];

        if (!app.license_key) {
            return res.status(400).json({ error: 'No key has been issued for this application yet' });
        }

        // 1. Invalidate old key
        await db.query('UPDATE license_keys SET is_used = TRUE, notes = $1 WHERE key_id = $2',
            [`Reissued at ${new Date().toISOString()}`, app.license_key]);

        // 2. Generate and issue new key
        const crypto = require('crypto');
        const randomBuffer = crypto.randomBytes(4);
        const newKey = `AK-${randomBuffer.toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

        // We reuse the same tier and duration logic from the original issue (simplified here)
        await db.query(`
            INSERT INTO license_keys (key_id, tier, duration_months, reserved_user_id, notes)
            VALUES ($1, $2, $3, $4, $5)
        `, [newKey, app.parsed_tier || 'Pro', 1, app.author_id, `Reissued key for App ID: ${id}`]);

        // 3. Update application
        await db.query('UPDATE applications SET license_key = $1 WHERE id = $2', [newKey, id]);

        // 4. Log
        const operatorId = req.user?.userId || 'Unknown';
        const operatorName = req.user?.username || 'Unknown';
        await db.query(`
            INSERT INTO operation_logs (operator_id, operator_name, target_id, target_name, action_type, details)
            VALUES ($1, $2, $3, $4, 'REISSUE_KEY', $5)
        `, [operatorId, operatorName, id, `${app.author_name} (${app.parsed_booth_name})`, `Reissued key: ${newKey}`]);

        // 5. Send DM and Notify Webhook
        const isAdmin = req.user?.role === 'admin';
        const dashboardUrl = `${process.env.PUBLIC_URL || ''}/#apps`;
        await sendWebhookNotification({
            title: isAdmin ? '🔑 【再発行】いたしました' : '⚠️ 【非管理者操作】再発行',
            description: `**対象者:** ${app.author_name} (\`${app.author_id}\`)\n**Booth:** ${app.parsed_booth_name}\n**新キー:** \`${newKey}\`\n\n[管理画面を見る](${dashboardUrl})`,
            color: isAdmin ? 0x9b59b6 : 0xffa500,
            fields: [{ name: '担当者', value: operatorName, inline: true }]
        });

        const client = req.app.discordClient;
        if (client && app.author_id) {
            try {
                const user = await client.users.fetch(app.author_id);
                await user.send({
                    content: `お嬢様、ライセンスキーの再発行を承りましたわ！\n以前のキーは無効化いたしましたので、こちらの新しいキーをご使用くださいまし。\n\n**新しいライセンスキー:** \`${newKey}\`\n\n\` /activate \` コマンドで有効化をお願いします。`
                });
            } catch (dmErr) {
                console.warn(`[Reissue] Failed to DM user ${app.author_id}:`, dmErr.message);
            }
        }

        res.json({ success: true, newKey });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
