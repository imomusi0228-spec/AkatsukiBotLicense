// filename: src/services/orderService.js
const db = require('../config/database');
const logger = require('../utils/logger');
const { normalizeOrderNumber } = require('../utils/normalize');
const { sendWebhookNotification } = require('../../services/notif');

/**
 * 注文情報をDBに保存する（存在しない場合のみ）
 * @param {Object} parsedMail 解析済みメールデータ
 * @returns {Promise<Object|null>} 登録された注文オブジェクト
 */
const createOrderIfNotExists = async (parsedMail) => {
    const { orderNumber, productName, buyerEmail, planType, raw } = parsedMail;
    
    if (!orderNumber) {
        logger.warn('[OrderService] Cannot create order: missing order number');
        return null;
    }

    try {
        // 重複チェックと挿入を1つのクエリで行う
        const query = `
            INSERT INTO orders (
                order_number, 
                order_number_normalized, 
                buyer_email, 
                buyer_email_normalized, 
                buyer_name,
                gift_recipient,
                product_name, 
                plan_type, 
                source_message_id, 
                raw_subject, 
                raw_body, 
                mail_received_at
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (order_number_normalized) DO NOTHING
            RETURNING *
        `;
        
        const res = await db.query(query, [
            orderNumber, // 元の番号
            normalizeOrderNumber(orderNumber), // 正規化済み
            buyerEmail,
            buyerEmail ? buyerEmail.toLowerCase() : null,
            parsedMail.buyerName,
            parsedMail.giftRecipient,
            productName,
            planType,
            raw.messageId,
            raw.subject,
            raw.text,
            raw.date
        ]);

        if (res.rowCount > 0) {
            const newOrder = res.rows[0];
            logger.info('[OrderService] New order imported:', { 
                orderNumber: newOrder.order_number, 
                plan: newOrder.plan_type 
            });
            
            // 監査ログに記録
            await db.query(
                'INSERT INTO audit_logs (action_type, actor_type, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5)',
                ['ORDER_IMPORTED', 'SYSTEM', 'ORDER', newOrder.id, JSON.stringify({ order_number: newOrder.order_number })]
            );

            // Webhook通知
            let mailDesc = `**注文番号:** \`${newOrder.order_number}\`\n**購入者:** ${newOrder.buyer_name || '不明'}`;
            if (newOrder.gift_recipient) {
                mailDesc += `\n**🎁 受取人:** ${newOrder.gift_recipient}`;
            }
            mailDesc += `\n**プラン:** ${newOrder.plan_type}\n**商品名:** ${newOrder.product_name}`;

            await sendWebhookNotification({
                title: '📩 【メール受信】届きました',
                description: mailDesc,
                color: 0x9b59b6 // Purple for mail
            });
            
            return newOrder;
        } else {
            // すでに存在する場合
            return null;
        }
    } catch (err) {
        logger.error('[OrderService] Error in createOrderIfNotExists:', err);
        throw err;
    }
};

/**
 * 注文番号から注文を取得する
 */
const getOrderByNumber = async (orderNumber) => {
    const normalized = normalizeOrderNumber(orderNumber);
    const res = await db.query('SELECT * FROM orders WHERE order_number_normalized = $1', [normalized]);
    return res.rows[0] || null;
};

/**
 * 注文を使用済みにマークする
 */
const markOrderUsed = async (orderId, discordId) => {
    const query = `
        UPDATE orders 
        SET used = TRUE, used_by_discord_id = $1, used_at = NOW(), updated_at = NOW() 
        WHERE id = $2
        RETURNING *
    `;
    const res = await db.query(query, [discordId, orderId]);
    
    if (res.rowCount > 0) {
        await db.query(
            'INSERT INTO audit_logs (action_type, actor_type, actor_id, target_type, target_id) VALUES ($1, $2, $3, $4, $5)',
            ['ORDER_USED', 'USER', discordId, 'ORDER', orderId]
        );
    }
    
    return res.rows[0];
};

/**
 * 注文の詳細情報を取得（管理者用）
 */
const lookupOrderDetail = async (orderNumber) => {
    const normalized = normalizeOrderNumber(orderNumber);
    const res = await db.query('SELECT * FROM orders WHERE order_number_normalized = $1', [normalized]);
    return res.rows[0] || null;
};

module.exports = {
    createOrderIfNotExists,
    getOrderByNumber,
    markOrderUsed,
    lookupOrderDetail
};
