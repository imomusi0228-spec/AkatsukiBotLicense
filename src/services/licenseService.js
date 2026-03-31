// filename: src/services/licenseService.js
const db = require('../config/database');
const logger = require('../utils/logger');
const { PLANS } = require('../constants/plans');
const { generateLicenseKey, addDays } = require('../utils/generator');
const { isExpired } = require('../utils/date');

/**
 * 注文情報を元にライセンスを新規作成する（または既存キーに情報を紐付ける）
 * 実際のDB構造：license_keys テーブルを使用
 */
const createLicenseFromOrder = async (order, discordId) => {
    return await db.transaction(async (client) => {
        return await createLicenseFromOrderInTx(client, order, discordId);
    });
};

/**
 * トランザクション内でのライセンス作成
 */
const createLicenseFromOrderInTx = async (client, order, discordId) => {
    const plan = PLANS[order.plan_type] || PLANS.FREE;
    
    // license_keys テーブルへ挿入（または既存があれば更新）
    // key_id, tier, duration_months, duration_days, is_used, used_by_user, used_at, notes
    const licenseKey = generateLicenseKey();
    const durationMonths = plan.durationMonths || 0;
    const durationDays = plan.durationDays || 0;

    try {
        const query = `
            INSERT INTO license_keys (
                key_id, 
                tier, 
                duration_months, 
                duration_days, 
                is_used, 
                used_by_user, 
                used_at, 
                notes
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
            RETURNING *
        `;
        
        const res = await client.query(query, [
            licenseKey,
            order.plan_type,
            durationMonths,
            durationDays,
            true, // 使用済みに設定
            discordId,
            `From order: ${order.order_number}`
        ]);

        const newLicense = res.rows[0];
        logger.info('[LicenseService] License key created/assigned:', { 
            key: newLicense.key_id, 
            usedBy: newLicense.used_by_user 
        });

        return newLicense;
    } catch (err) {
        logger.error('[LicenseService] Error in createLicenseFromOrderInTx:', err);
        throw err;
    }
};

/**
 * ユーザーのライセンス一覧を取得（所有キー + 有効化中サーバー）
 */
const getLicensesByDiscordId = async (discordId) => {
    // 1. 所有しているライセンスキーを取得 (license_keys)
    // used_by_user (使用中) または reserved_user_id (予約済み) のいずれかが一致するものを対象とする
    // システム側で自動生成された管理用キー（Generated for App 等）は、ユーザー自身が申請したものではないため除外する
    const keysRes = await db.query(
        `SELECT * FROM license_keys 
         WHERE (used_by_user = $1 OR reserved_user_id = $1)
         AND (notes IS NULL OR (notes NOT LIKE '%Generated for App%' AND notes NOT LIKE '%App ID:%'))
         ORDER BY created_at DESC`, 
        [discordId]
    );
    
    // 2. 有効化中のサーバーを取得 (subscriptions)
    const subsRes = await db.query(
        'SELECT * FROM subscriptions WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at DESC',
        [discordId]
    );

    return {
        ownedKeys: keysRes.rows,
        activeSubscriptions: subsRes.rows
    };
};

/**
 * ライセンスの検証（API認証用 - 既存ロジックを必要に応じて維持）
 */
const verifyLicense = async ({ licenseKey, machineId, deviceName, ipAddress }) => {
    // 1. ライセンスキーの存在確認
    const res = await db.query('SELECT * FROM license_keys WHERE key_id = $1', [licenseKey]);
    const license = res.rows[0];

    if (!license) return { success: false, message: 'License key not found' };
    if (!license.is_used) return { success: false, message: 'License key not activated' };

    // ... (その他の検証ロジックは必要に応じて subscriptions テーブル等を参照するように拡張可能)
    return {
        success: true,
        tier: license.tier
    };
};

module.exports = {
    createLicenseFromOrder,
    createLicenseFromOrderInTx,
    getLicensesByDiscordId,
    verifyLicense
};
