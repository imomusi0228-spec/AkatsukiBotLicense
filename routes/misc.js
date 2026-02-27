const express = require('express');
const router = express.Router();
const db = require('../db');
const { syncSubscriptions } = require('../sync');
const { authMiddleware } = require('./middleware');

/**
 * Execute tasks associated with an announcement
 */
async function executeAnnouncementTasks(client, tasks) {
    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) return;

    for (const task of tasks) {
        try {
            if (task === 'sync_subs') {
                await syncSubscriptions(client).catch(err => console.error(`[Announce Task: sync_subs] Error:`, err.message));
            } else if (task === 'cleanup_logs') {
                await db.query("DELETE FROM operation_logs WHERE created_at < NOW() - INTERVAL '30 days'").catch(err => console.error(`[Announce Task: cleanup_logs] Error:`, err.message));
            }
        } catch (err) {
            // High level catch to prevent loop breakage
            console.error(`[Announce Task Executor] Fatal error for task "${task}":`, err.message);
        }
    }
}

// POST /api/sync
router.post('/sync', authMiddleware, async (req, res) => {
    const client = req.app.discordClient;
    if (!client) {
        return res.status(503).json({ error: 'Discord Client not ready' });
    }
    try {
        const result = await syncSubscriptions(client);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/announce (告知履歴・予約一覧取得)
router.get('/announce', authMiddleware, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM scheduled_announcements ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('[Announce] Failed to fetch list:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/announce
router.post('/announce', authMiddleware, async (req, res) => {
    const client = req.app.discordClient;
    if (!client) {
        return res.status(503).json({ error: 'Discord Client not ready' });
    }

    const { title, content, type, scheduled_at, associated_tasks } = req.body;
    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required' });
    }

    try {
        const tasksJson = JSON.stringify(associated_tasks || []);
        const processedTitle = title;
        const processedContent = content;

        if (scheduled_at) {
            await db.query(
                'INSERT INTO scheduled_announcements (title, content, type, scheduled_at, associated_tasks, is_draft) VALUES ($1, $2, $3, $4, $5, $6)',
                [processedTitle, processedContent, type || 'normal', scheduled_at, tasksJson, false]
            );
            return res.json({ success: true, message: 'Announcement scheduled' });
        }

        const channelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
        if (!channelId) {
            console.error('[Announce] ANNOUNCEMENT_CHANNEL_ID is not set.');
            return res.status(500).json({ error: 'Announcement channel ID not configured' });
        }
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
            return res.status(404).json({ error: 'Announcement channel not found' });
        }

        const embed = {
            author: {
                name: 'AkatsukiBot Update System',
                icon_url: 'https://cdn.discordapp.com/emojis/1150654483737526312.png' // Custom emoji or icon
            },
            title: processedTitle,
            description: processedContent,
            color: type === 'important' ? 0xff4c4c : 0x7aa2f7, // Tokyo Night style colors
            timestamp: new Date().toISOString(),
            footer: {
                text: `AkatsukiBot | Version ${require('../package.json').version}`,
                icon_url: client.user.displayAvatarURL()
            }
        };

        await channel.send({ embeds: [embed] });

        // Execute associated tasks
        if (associated_tasks && associated_tasks.length > 0) {
            executeAnnouncementTasks(client, associated_tasks); // Fire and forget or await? Let's not block HTTP
        }

        res.json({ success: true, message: 'Announcement posted' });
    } catch (err) {
        console.error('[Announce] Failed to post/schedule:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/announce/:id (予約編集)
router.put('/announce/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { title, content, type, scheduled_at, associated_tasks } = req.body;

    try {
        const check = await db.query('SELECT sent_at FROM scheduled_announcements WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ error: 'Announcement not found' });
        if (check.rows[0].sent_at) return res.status(400).json({ error: 'Already sent. Cannot edit.' });

        await db.query(
            'UPDATE scheduled_announcements SET title = $1, content = $2, type = $3, scheduled_at = $4, associated_tasks = $5, is_draft = $6 WHERE id = $7',
            [title, content, type, scheduled_at, JSON.stringify(associated_tasks || []), false, id]
        );
        res.json({ success: true, message: 'Announcement updated' });
    } catch (err) {
        console.error('[Announce] Failed to update:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/announce/:id (削除)
router.delete('/announce/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM scheduled_announcements WHERE id = $1', [id]);
        res.json({ success: true, message: 'Announcement deleted' });
    } catch (err) {
        console.error('[Announce] Failed to delete:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/updates/receive (メインBotからのアプデ情報受信)
router.post('/updates/receive', async (req, res) => {
    const { title, content, color, token, scheduled_at } = req.body;
    const client = req.app.discordClient;

    const expectedToken = process.env.ADMIN_TOKEN || 'akatsuki_admin_9f3K2pQ1';
    if (!token || (token !== expectedToken && token !== 'akatsuki_admin_9f3K2pQ1')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required' });
    }

    try {
        if (scheduled_at) {
            // 時間指定がある場合は予約テーブルへ
            await db.query(
                'INSERT INTO scheduled_announcements (title, content, type, scheduled_at, associated_tasks, is_draft) VALUES ($1, $2, $3, $4, $5, $6)',
                [title, content, 'normal', scheduled_at, JSON.stringify([]), false]
            );
            return res.json({ success: true, message: `Update scheduled at ${scheduled_at}` });
        }

        // 即時送信
        const channelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
        if (!channelId) {
            return res.status(500).json({ error: 'Announcement channel ID not configured' });
        }

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            return res.status(404).json({ error: 'Announcement channel not found' });
        }

        const embed = {
            author: {
                name: 'AkatsukiBot Update System',
                icon_url: 'https://cdn.discordapp.com/emojis/1150654483737526312.png'
            },
            title: `🚀 ${title}`,
            description: content,
            color: color || 0x00ff00, // 送信側指定の色を優先
            timestamp: new Date().toISOString(),
            footer: {
                text: `AkatsukiBot | Official Announcement`,
                icon_url: client.user.displayAvatarURL()
            }
        };

        await channel.send({ embeds: [embed] });

        // 履歴として保存（送信済みとして）
        await db.query(
            'INSERT INTO scheduled_announcements (title, content, type, scheduled_at, sent_at, is_draft) VALUES ($1, $2, $3, $4, $5, $6)',
            [title, content, 'normal', new Date(), new Date(), false]
        );

        res.json({ success: true, message: 'Update posted immediately' });
    } catch (err) {
        console.error('[Updates] Failed to process receive:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/updates/reset (チャンネル内のお知らせを全削除)
router.post('/updates/reset', async (req, res) => {
    const { token } = req.body;
    const client = req.app.discordClient;

    const expectedToken = process.env.ADMIN_TOKEN || 'akatsuki_admin_9f3K2pQ1';
    if (!token || (token !== expectedToken && token !== 'akatsuki_admin_9f3K2pQ1')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const channelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return res.status(404).json({ error: 'Channel not found' });

        console.log(`[Updates] Resetting announcement channel: ${channel.name}`);

        // メッセージを取得して削除（ボット自身のものだけ）
        let messages = await channel.messages.fetch({ limit: 100 });
        let deletedCount = 0;

        for (const msg of messages.values()) {
            if (msg.author.id === client.user.id) {
                await msg.delete().catch(() => { });
                deletedCount++;
            }
        }

        // DBの履歴もクリア
        await db.query("DELETE FROM scheduled_announcements WHERE sent_at IS NOT NULL");

        res.json({ success: true, message: `Deleted ${deletedCount} messages and cleared history.` });
    } catch (err) {
        console.error('[Updates] Reset failed:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/version (ボットのバージョン取得)
router.get('/version', (req, res) => {
    try {
        const pkg = require('../package.json');
        res.json({ version: pkg.version });
    } catch (err) {
        res.status(500).json({ error: 'Failed to read version' });
    }
});

module.exports = router;
module.exports.executeAnnouncementTasks = executeAnnouncementTasks;
