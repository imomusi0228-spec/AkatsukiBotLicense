// filename: src/services/licenseService.js
const db = require('../config/database');
const logger = require('../utils/logger');
const { PLANS } = require('../constants/plans');
const { generateLicenseKey, addDays } = require('../utils/generator');
const { normalizeMachineId } = require('../utils/normalize');
const { isExpired } = require('../utils/date');

/**
 * 注文情報を元にライセンスを新規作成する
 */
const createLicenseFromOrder = async (order, discordId) => {
    const plan = PLANS[order.plan_type] || PLANS.FREE;
    
    // すでにこの注文からライセンスが発行されていないかチェック
    const existing = await db.query('SELECT * FROM licenses WHERE order_id = $1', [order.id]);
    if (existing.rowCount > 0) {
        logger.warn('[LicenseService] License already exists for order:', order.order_number);
        return existing.rows[0];
    }

    const licenseKey = generateLicenseKey();
    const expiresAt = plan.durationDays ? addDays(new Date(), plan.durationDays) : null;

    try {
        const query = `
            INSERT INTO licenses (
                license_key, 
                discord_id, 
                order_id, 
                plan_type, 
                product_name, 
                max_servers, 
                expires_at
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `;
        
        const res = await db.query(query, [
            licenseKey,
            discordId,
            order.id,
            order.plan_type,
            order.product_name,
            plan.maxServers,
            expiresAt
        ]);

        const newLicense = res.rows[0];
        logger.info('[LicenseService] License created:', { 
            key: newLicense.license_key, 
            discordId: newLicense.discord_id 
        });

        // 監査ログ
        await db.query(
            'INSERT INTO audit_logs (action_type, actor_type, actor_id, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5, $6)',
            ['LICENSE_CREATED', 'SYSTEM', discordId, 'LICENSE', newLicense.id, JSON.stringify({ key: newLicense.license_key })]
        );

        return newLicense;
    } catch (err) {
        logger.error('[LicenseService] Error in createLicenseFromOrder:', err);
        throw err;
    }
};

/**
 * ユーザーのライセンス一覧を取得
 */
const getLicensesByDiscordId = async (discordId) => {
    const res = await db.query('SELECT * FROM licenses WHERE discord_id = $1 ORDER BY created_at DESC', [discordId]);
    return res.rows;
};

/**
 * ライセンスの検証（API認証用）
 */
const verifyLicense = async ({ licenseKey, machineId, deviceName, ipAddress }) => {
    const normalizedMachineId = normalizeMachineId(machineId);

    // 1. ライセンスの存在確認
    const res = await db.query('SELECT * FROM licenses WHERE license_key = $1', [licenseKey]);
    const license = res.rows[0];

    if (!license) return { success: false, message: 'License not found' };
    if (!license.is_active) return { success: false, message: 'License is inactive' };
    if (license.revoked_at) return { success: false, message: 'License revoked' };
    if (isExpired(license.expires_at)) return { success: false, message: 'License expired' };

    // 2. アクティベーションの確認
    if (normalizedMachineId) {
        const actRes = await db.query(
            'SELECT * FROM activations WHERE license_id = $1 AND machine_id_normalized = $2',
            [license.id, normalizedMachineId]
        );

        if (actRes.rowCount > 0) {
            // 既存デバイス: 最終確認日時を更新
            await db.query(
                'UPDATE activations SET last_verified_at = NOW(), ip_address = $1, device_name = $2 WHERE id = $3',
                [ipAddress, deviceName, actRes.rows[0].id]
            );
        } else {
            // 新規デバイス: 上限チェック
            if (license.max_servers !== -1 && license.activated_servers >= license.max_servers) {
                return { success: false, message: 'Device limit reached' };
            }

            // 登録
            await db.query(
                'INSERT INTO activations (license_id, machine_id, machine_id_normalized, device_name, ip_address) VALUES ($1, $2, $3, $4, $5)',
                [license.id, machineId, normalizedMachineId, deviceName, ipAddress]
            );

            // カウント更新
            await db.query('UPDATE licenses SET activated_servers = activated_servers + 1 WHERE id = $1', [license.id]);
            
            // 監査ログ
            await db.query(
                'INSERT INTO audit_logs (action_type, actor_type, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5)',
                ['ACTIVATION_CREATED', 'SYSTEM', 'ACTIVATION', license.id, JSON.stringify({ machineId: normalizedMachineId })]
            );
        }
    }

    return {
        success: true,
        planType: license.plan_type,
        productName: license.product_name,
        maxServers: license.max_servers,
        activeDevices: license.activated_servers,
        expiresAt: license.expires_at,
        isPermanent: license.expires_at === null
    };
};

/**
 * デバイスのアクティベーション解除
 */
const deactivateMachine = async ({ licenseKey, machineId }) => {
    const normalized = normalizeMachineId(machineId);
    
    return await db.transaction(async (client) => {
        const licRes = await client.query('SELECT * FROM licenses WHERE license_key = $1', [licenseKey]);
        if (licRes.rowCount === 0) return false;
        
        const license = licRes.rows[0];
        const delRes = await client.query(
            'DELETE FROM activations WHERE license_id = $1 AND machine_id_normalized = $2',
            [license.id, normalized]
        );

        if (delRes.rowCount > 0) {
            await client.query('UPDATE licenses SET activated_servers = GREATEST(0, activated_servers - 1) WHERE id = $1', [license.id]);
            
            await client.query(
                'INSERT INTO audit_logs (action_type, actor_type, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5)',
                ['ACTIVATION_REMOVED', 'SYSTEM', 'ACTIVATION', license.id, JSON.stringify({ machineId: normalized })]
            );
            return true;
        }
        return false;
    });
};

/**
 * ライセンスの無効化（失効）
 */
const revokeLicense = async ({ licenseKey, reason, actorId }) => {
    const query = `
        UPDATE licenses 
        SET is_active = FALSE, revoked_at = NOW(), revoked_reason = $1, updated_at = NOW() 
        WHERE license_key = $2
        RETURNING *
    `;
    const res = await db.query(query, [reason, licenseKey]);
    
    if (res.rowCount > 0) {
        await db.query(
            'INSERT INTO audit_logs (action_type, actor_type, actor_id, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5, $6)',
            ['LICENSE_REVOKED', 'ADMIN', actorId, 'LICENSE', res.rows[0].id, JSON.stringify({ reason })]
        );
    }
    
    return res.rows[0];
};

/**
 * ライセンスのアクティベーション全リセット
 */
const resetLicenseActivations = async (licenseKey, actorId) => {
    return await db.transaction(async (client) => {
        const licRes = await client.query('SELECT * FROM licenses WHERE license_key = $1', [licenseKey]);
        if (licRes.rowCount === 0) return false;
        
        const license = licRes.rows[0];
        await client.query('DELETE FROM activations WHERE license_id = $1', [license.id]);
        await client.query('UPDATE licenses SET activated_servers = 0 WHERE id = $1', [license.id]);
        
        await client.query(
            'INSERT INTO audit_logs (action_type, actor_type, actor_id, target_type, target_id) VALUES ($1, $2, $3, $4, $5)',
            ['LICENSE_RESET', 'ADMIN', actorId, 'LICENSE', license.id]
        );
        return true;
    });
};

module.exports = {
    createLicenseFromOrder,
    getLicensesByDiscordId,
    verifyLicense,
    deactivateMachine,
    revokeLicense,
    resetLicenseActivations
};
