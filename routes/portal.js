const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('./middleware');
const rateLimit = require('express-rate-limit');
const { normalizeOrderNumber } = require('../src/utils/normalize'); // src配下にあるため階層に注意

// トークン照会用の専用レートリミッター (15分に5回まで)
const lookupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'リクエスト回数が多すぎます。しばらく時間を置いてから再度お試しください。' },
    standardHeaders: true,
    legacyHeaders: false,
});

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
// POST /api/portal/licenses/:guildId/move (User-initiated Deactivation)
router.post('/licenses/:guildId/move', authMiddleware, async (req, res) => {
    const { guildId } = req.params;
    const userId = req.user.userId;
    const username = req.user.username;

    try {
        const subRes = await db.query('SELECT * FROM subscriptions WHERE guild_id = $1 AND user_id = $2 AND is_active = TRUE', [guildId, userId]);
        if (subRes.rows.length === 0) return res.status(404).json({ error: '有効なライセンスが見つからないか、あなたの所有物ではありません。' });
        
        const sub = subRes.rows[0];

        // クールダウンチェック (30日間)
        const lastMigration = sub.last_migration_at ? new Date(sub.last_migration_at) : null;
        const cooldownDays = 30;
        if (lastMigration && (Date.now() - lastMigration.getTime()) < cooldownDays * 24 * 60 * 60 * 1000) {
            const nextAvailable = new Date(lastMigration.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
            return res.status(403).json({ 
                error: `まだ引越しはできません。前回の引越しから${cooldownDays}日間のクールダウンが必要です。`,
                nextAvailable: nextAvailable.toISOString()
            });
        }

        // 解除実行
        await db.query(`
            UPDATE subscriptions 
            SET is_active = FALSE, migration_count = migration_count + 1, last_migration_at = NOW(), updated_at = NOW() 
            WHERE id = $1
        `, [sub.id]);

        // 操作ログ
        await db.query('INSERT INTO operation_logs (operator_id, operator_name, target_id, target_name, action_type, details) VALUES ($1, $2, $3, $4, $5, $6)',
            [userId, username, guildId, sub.cached_servername || guildId, 'USER_MOVE_INIT', `User deactivated license for migration`]);

        res.json({ success: true, message: 'サーバーの紐付けを解除しました。新しいサーバーで /activate を実行してください。' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/portal/lookup (Public Token Lookup)
router.post('/lookup', lookupLimiter, async (req, res) => {
    const { orderNumber, buyerName } = req.body;

    if (!orderNumber || !buyerName) {
        return res.status(400).json({ error: '注文番号と購入時の名前を入力してください。' });
    }

    try {
        const normalizedInputOrder = normalizeOrderNumber(orderNumber);
        const normalizedInputName = buyerName.replace(/\s+/g, '').toLowerCase();

        // 注文を検索
        const result = await db.query(
            'SELECT * FROM orders WHERE order_number_normalized = $1',
            [normalizedInputOrder]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '注文が見つかりません。入力内容をご確認ください。' });
        }

        const order = result.rows[0];
        const normalizedDbName = (order.buyer_name || '').replace(/\s+/g, '').toLowerCase();

        // 名前を照合
        if (normalizedDbName !== normalizedInputName) {
            return res.status(403).json({ error: '購入者名が一致しません。' });
        }

        // 時間ベースの照合 (ランダム認証)
        const { verifyField, verifyValue } = req.body;
        if (verifyField && verifyValue) {
            const orderTime = new Date(order.mail_received_at);
            let actualValue;
            
            switch (verifyField) {
                case 'hour': actualValue = orderTime.getHours().toString().padStart(2, '0'); break;
                case 'minute': actualValue = orderTime.getMinutes().toString().padStart(2, '0'); break;
                case 'second': actualValue = orderTime.getSeconds().toString().padStart(2, '0'); break;
                default: return res.status(400).json({ error: '無効な照合項目です。' });
            }

            // 入力値を正規化 (1桁なら0埋め)
            const normalizedInput = verifyValue.toString().padStart(2, '0');

            if (actualValue !== normalizedInput) {
                return res.status(403).json({ error: `注文時の「${verifyField === 'hour' ? '時' : (verifyField === 'minute' ? '分' : '秒')}」が一致しません。` });
            }
        } else {
            // フィールドがない場合はエラー (フロントエンドで必ず送るようにする)
            return res.status(400).json({ error: '時間情報の照合が必要です。' });
        }

        // トークンを返却
        res.json({
            success: true,
            orderNumber: order.order_number,
            token: order.activation_token,
            used: order.used,
            planType: order.plan_type
        });

    } catch (err) {
        console.error('[Lookup API] Error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました。' });
    }
});

module.exports = router;
