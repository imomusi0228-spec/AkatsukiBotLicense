const db = require('../db');
const { sendWebhookNotification } = require('./notif');
const crypto = require('crypto');
const { normalizeOrderNumber } = require('../src/utils/normalize');
const TRIAL_TIERS = ['Trial Pro', 'Trial Pro+'];

/**
 * Checks if a user has already used a trial.
 * @param {string} userId 
 * @returns {Promise<boolean>}
 */
async function hasUsedTrial(userId) {
    if (!userId) return false;
    const result = await db.query(
        "SELECT id FROM applications WHERE parsed_user_id = $1 AND status = 'approved' AND parsed_tier LIKE 'Trial%'",
        [userId]
    );
    return result.rows.length > 0;
}

/**
 * Saves or updates a license application.
 * @param {Object} appData 
 * @param {Object} client Discord client (optional for auto-DM)
 * @returns {Promise<Object>} The saved application data
 */
async function saveApplication(appData, client = null) {
    const {
        messageId,
        channelId,
        authorId,
        authorName,
        content,
        userId,
        guildId,
        tier,
        boothName,
        boothOrderId: boothOrderIdRaw,   // S-3: Booth注文番号
        sourceType // 'message' or 'modal'
    } = appData;

    const boothOrderId = normalizeOrderNumber(boothOrderIdRaw);

    try {
        // Check for existing application by same user and guild
        const existing = await db.query(
            'SELECT id FROM applications WHERE parsed_user_id = $1 AND parsed_guild_id = $2',
            [userId, guildId]
        );

        let resultId;
        if (existing.rows.length > 0) {
            resultId = existing.rows[0].id;
            await db.query(`
                UPDATE applications SET
                    message_id = $1,
                    channel_id = $2,
                    author_id = $3,
                    author_name = $4,
                    content = $5,
                    parsed_tier = $6,
                    parsed_booth_name = $7,
                    booth_order_id = $8,
                    status = 'pending',
                    created_at = CURRENT_TIMESTAMP
                WHERE id = $9
            `, [
                messageId, channelId, authorId, authorName, content,
                tier, boothName, boothOrderId || null, resultId
            ]);
            console.log(`[AppService] Existing application updated (ID: ${resultId}, Source: ${sourceType})`);
        } else {
            // S-3: Booth注文番号の重複チェック
            if (boothOrderId) {
                const dupCheck = await db.query(
                    "SELECT id FROM applications WHERE booth_order_id = $1 AND status = 'approved'",
                    [boothOrderId]
                );
                if (dupCheck.rows.length > 0) {
                    console.warn(`[AppService] Duplicate booth_order_id detected: ${boothOrderId}`);
                    await sendWebhookNotification({
                        title: '⚠️ 注文番号重複警告',
                        description: `**申請者:** ${authorName} (\`${authorId}\`)\n**注文番号:** \`${boothOrderId}\`\n\nこの注文番号は既に承認済みの申請が存在します。要確認。`,
                        color: 0xff8c00
                    });
                }
            }

            const res = await db.query(`
                INSERT INTO applications (
                    message_id, channel_id, author_id, author_name, content,
                    parsed_user_id, parsed_guild_id, parsed_tier, parsed_booth_name, booth_order_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (message_id) DO NOTHING
                RETURNING id
            `, [
                messageId, channelId, authorId, authorName, content,
                userId, guildId, tier, boothName, boothOrderId || null
            ]);
            resultId = res.rows[0]?.id;
            console.log(`[AppService] New application saved (Source: ${sourceType})`);
        }


        // Notify admins via webhook
        const dashboardUrl = `${process.env.PUBLIC_URL || ''}/#apps`;
        await sendWebhookNotification({
            title: '📩 【新規申請】届きました',
            description: `**申請者:** ${authorName} (${authorId})\n**希望プラン:** ${tier}\n**サーバーID:** \`${guildId}\`\n**購入者名:** ${boothName}\n\n[管理画面を見る](${dashboardUrl})`,
            color: 0x00ff00
        });

        // Check for Auto-Approval rules
        const OJOU_ID = '341304248010539022';
        let autoRejected = false;
        let autoProcessed = false;

        // Ojou Bypass: Highest priority
        if (userId === OJOU_ID) {
            console.log(`[AppService] Ojou detected (ID: ${userId}). Auto-approving ULTIMATE tier.`);
            // Update application with ULTIMATE tier before approval
            await db.query("UPDATE applications SET parsed_tier = 'ULTIMATE' WHERE id = $1", [resultId]);
            await approveApplication(resultId, 'SYSTEM_AUTO', 'System (Ojou Bypass)', true, client);
            return { success: true, id: resultId, auto_processed: true, auto_rejected: false };
        }

        // --- NEW LOGIC: Existing Quota Auto-Approval ---
        try {
            const existingResult = await db.query('SELECT * FROM subscriptions WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at ASC', [userId]);
            const existingSubs = existingResult.rows;

            if (existingSubs.length > 0) {
                // Determine limits and highest tier
                const normalizeTier = (t) => String(t || '').replace(/[\s\-_]/g, '').toUpperCase();
                
                const isProPlus = (t) => {
                    const norm = normalizeTier(t);
                    return norm === 'PRO+' || norm === 'PROPLUS' || norm === '3' || norm === '4' || norm === 'TRIALPRO+';
                };
                const isUltimate = (t) => normalizeTier(t) === 'ULTIMATE';

                const hasUltimate = existingSubs.some(s => isUltimate(s.tier));
                const hasProPlus = existingSubs.some(s => isProPlus(s.tier));

                let maxLimit = 1;
                let highestTierStr = 'Pro';
                if (hasUltimate) {
                    maxLimit = 999;
                    highestTierStr = 'ULTIMATE';
                } else if (hasProPlus) {
                    maxLimit = 3;
                    highestTierStr = 'Pro+';
                }

                if (existingSubs.length < maxLimit) {
                    console.log(`[AppService] Existing quota found for User: ${userId}. Auto-approving ${highestTierStr} tier.`);
                    
                    // Update application tier to the highest they own
                    await db.query("UPDATE applications SET parsed_tier = $1 WHERE id = $2", [highestTierStr, resultId]);
                    
                    // Automatically approve using system account
                    await approveApplication(resultId, 'SYSTEM_AUTO', 'System (Quota Auto-Approval)', true, client);
                    
                    return { success: true, id: resultId, auto_processed: true, auto_rejected: false };
                } else {
                    console.log(`[AppService] User ${userId} has hit max limit (${maxLimit}) for their active subscriptions. Falling back to normal flow.`);
                }
            }
        } catch (quotaErr) {
            console.error('[AppService] Error checking existing quota:', quotaErr);
        }
        // --- END NEW LOGIC ---

        const isTrial = TRIAL_TIERS.includes(tier);

        if (isTrial) {
            const alreadyUsed = await hasUsedTrial(userId);
            if (alreadyUsed) {
                console.log(`[AppService] Trial rejected (already used) for User: ${userId}`);
                await db.query("UPDATE applications SET status = 'rejected' WHERE id = $1", [resultId]);

                // Notify via webhook with specific reason
                await sendWebhookNotification({
                    title: '🚫 トライアル申請却下 (重複利用)',
                    description: `**申請者:** ${authorName} (\`${authorId}\`)\n**内容:** トライアルは1回限りです。有料プランをご検討ください。\n\n[**管理画面で確認**](${dashboardUrl})`,
                    color: 0xff0000
                });
                autoRejected = true;
            } else {
                console.log(`[AppService] Auto-approving trial for User: ${userId}`);
                await approveApplication(resultId, 'SYSTEM_AUTO', 'System (Auto Trial)', true, client);
                autoProcessed = true;
            }
        } else {
            // --- NEW: Strict BOOTH Order Matching ---
            if (boothOrderId) {
                try {
                    const orderRes = await db.query(
                        "SELECT * FROM orders WHERE order_number_normalized = $1 AND used = FALSE",
                        [boothOrderId]
                    );
                    if (orderRes.rows.length > 0) {
                        const order = orderRes.rows[0];
                        // Normalize names for comparison (remove spaces)
                        const normalizeName = (n) => String(n || '').replace(/[\s\u3000]/g, '').toLowerCase();
                        const cleanAppBoothName = normalizeName(boothName);
                        const cleanOrderBuyerName = normalizeName(order.buyer_name);
                        const cleanOrderRecipientName = normalizeName(order.gift_recipient);
                        
                        const normalizeTier = (t) => String(t || '').replace(/[\s\-_]/g, '').toUpperCase();
                        
                        // Check if Name matches either buyer or recipient, and Plan matches
                        const nameMatch = (cleanAppBoothName === cleanOrderBuyerName) || 
                                          (cleanOrderRecipientName && cleanAppBoothName === cleanOrderRecipientName);
                        const planMatch = normalizeTier(tier) === normalizeTier(order.plan_type);

                        if (nameMatch && planMatch) {
                            console.log(`[AppService] Strict BOOTH matching success (Gift-aware) for App ID: ${resultId}. Auto-approving.`);
                            
                            // Mark order as used
                            await db.query(
                                "UPDATE orders SET used = TRUE, used_by_discord_id = $1, used_at = NOW() WHERE id = $2",
                                [userId, order.id]
                            );

                            await approveApplication(resultId, 'SYSTEM_AUTO', 'System (Strict BOOTH Matching)', true, client);
                            await db.query('UPDATE applications SET auto_processed = TRUE WHERE id = $1', [resultId]);
                            return { success: true, id: resultId, auto_processed: true, auto_rejected: false };
                        } else {
                            console.log(`[AppService] Strict BOOTH matching failed validation: NameMatch=${nameMatch}, PlanMatch=${planMatch}`);
                        }
                    }
                } catch (orderMatchErr) {
                    console.error('[AppService] Error during strict BOOTH matching:', orderMatchErr);
                }
            }

            // Fallback: Check for Auto-Approval rules for Pro/Pro+ (Legacy/Custom rules)
            const ruleCheck = await checkAutoApproval(boothName, content, authorName);
            if (ruleCheck) {
                console.log(`[AppService] Auto-approval rule triggered for App ID: ${resultId}`);
                await approveApplication(resultId, 'SYSTEM_AUTO', 'System (Auto Rule)', true, client);
                await db.query('UPDATE applications SET auto_processed = TRUE WHERE id = $1', [resultId]);
                autoProcessed = true;
            }
        }

        return { success: true, id: resultId, auto_processed: autoProcessed, auto_rejected: autoRejected };
    } catch (err) {
        console.error('[AppService] Error saving application:', err);
        throw err;
    }
}

/**
 * Checks if an application matches any auto-approval rules.
 */
async function checkAutoApproval(boothName, content, authorName = '') {
    try {
        const rules = await db.query('SELECT * FROM auto_approval_rules WHERE is_active = TRUE');
        for (const rule of rules.rows) {
            const matchType = rule.match_type || 'regex';
            let isMatch = false;

            if (matchType === 'name_match') {
                // Check if authorName exactly matches boothName (case-insensitive)
                if (authorName && boothName && authorName.toLowerCase().trim() === boothName.toLowerCase().trim()) {
                    isMatch = true;
                }
            } else if (matchType === 'exact') {
                if (boothName && boothName.toLowerCase().trim() === (rule.pattern || '').toLowerCase().trim()) {
                    isMatch = true;
                }
            } else {
                // Default: regex
                const pattern = new RegExp(rule.pattern, 'i');
                if (pattern.test(boothName) || pattern.test(content)) {
                    isMatch = true;
                }
            }

            if (isMatch) {
                // Extra safety: If tier_mode is follow_app, ensure we actually have a valid tier
                // If the app tier is missing or "Free", we might want to skip auto-approval
                // This will be handled in approveApplication, but we could return null here too.
                return rule;
            }
        }
    } catch (err) {
        console.error('[AppService] Error checking auto-approval:', err);
    }
    return null;
}

/**
 * Handles the approval process for an application.
 */
async function approveApplication(appId, operatorId, operatorName, isAuto = false, client = null) {
    const appRes = await db.query('SELECT * FROM applications WHERE id = $1', [appId]);
    if (appRes.rows.length === 0) throw new Error('Application not found');
    const app = appRes.rows[0];

    // 1. Determine Tier and Duration
    let tier = app.parsed_tier || 'Pro';
    let durationMonths = 1;
    let durationDays = null;

    if (tier === 'ULTIMATE') {
        durationMonths = null;
        durationDays = null;
    } else if (isAuto) {
        // Check if it was auto-approved and use rule settings if available
        const rule = await checkAutoApproval(app.parsed_booth_name, app.content, app.author_name);
        if (rule) {
            // Priority: If tier_mode is follow_app, use app.parsed_tier
            if (rule.tier_mode === 'follow_app' && app.parsed_tier && app.parsed_tier !== 'Free') {
                tier = app.parsed_tier;
            } else {
                tier = rule.tier;
            }
            durationMonths = rule.duration_months;
            durationDays = rule.duration_days;
        }
    } else {
        // Default legacy logic for manual approval
        if (tier === 'Trial Pro') {
            durationMonths = 0;
            durationDays = 14;
        } else if (tier === 'Trial Pro+') {
            durationMonths = 0;
            durationDays = 7;
        }
    }

    // 2. Generate Key
    const randomBuffer = crypto.randomBytes(4);
    const key = `AK-${randomBuffer.toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const reservedUser = app.parsed_user_id || null;

    // 3. Insert into license_keys
    await db.query(`
        INSERT INTO license_keys (key_id, tier, duration_months, duration_days, reserved_user_id, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
    `, [key, tier, durationMonths, durationDays, reservedUser, `Generated for App ID: ${appId} (${app.parsed_booth_name})`]);

    // 4. Update application status
    await db.query('UPDATE applications SET status = \'approved\', license_key = $1 WHERE id = $2', [key, appId]);

    // Ojou Special: Directly activate ULTIMATE tier
    if (tier === 'ULTIMATE') {
        const guildId = app.parsed_guild_id;
        const userId = app.parsed_user_id || app.author_id; // Robustness

        await db.query(`
            INSERT INTO subscriptions (guild_id, user_id, tier, expiry_date, is_active, updated_at)
            VALUES ($1, $2, $3, NULL, TRUE, NOW())
            ON CONFLICT (guild_id) DO UPDATE 
            SET user_id = EXCLUDED.user_id, 
                tier = EXCLUDED.tier, 
                expiry_date = NULL, 
                is_active = TRUE,
                updated_at = NOW()
        `, [guildId, userId, 'ULTIMATE']);

        console.log(`[AppService] ULTIMATE tier directly activated for Guild: ${guildId}, User: ${userId}`);
    }

    // 5. Log
    const targetDesc = `${app.author_name} (${app.parsed_booth_name})`;
    await db.query(`
        INSERT INTO operation_logs (operator_id, operator_name, target_id, target_name, action_type, details, metadata)
        VALUES ($1, $2, $3, $4, 'APPROVE_APP', $5, $6)
    `, [
        operatorId,
        operatorName,
        appId,
        targetDesc,
        `${isAuto ? 'Auto-approved' : 'Approved'} application for ${tier}`,
        JSON.stringify({ tier, key, author_id: app.author_id, is_auto: isAuto })
    ]);

    // 6. Notify
    const dashboardUrl = `${process.env.PUBLIC_URL || ''}/#apps`;
    await sendWebhookNotification({
        title: '✅ 【受理】完了いたしました',
        description: `**対象者:** ${app.author_name} (\`${app.author_id}\`)\n**プラン:** ${tier}\n**キー:** \`${key}\`\n\n[管理画面へ](${dashboardUrl})`,
        color: 0x2ecc71, // Consistent green
        fields: [
            { name: '処理タイプ', value: isAuto ? '⚡ 自動承認' : '👤 手動承認', inline: true },
            { name: '担当者', value: operatorName, inline: true }
        ]
    });

    // 7. Send DM to User (A-3)
    if (client) {
        try {
            const user = await client.users.fetch(app.author_id).catch(() => null);
            if (user) {
                const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                const portalUrl = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/portal.html` : null;

                const welcomeEmbed = {
                    title: '🎉 ライセンス承認のお知らせ',
                    description: `ご利用ありがとうございます！\n申請いただいたライセンスが承認されました。\n\n**プラン:** ${tier}\n**キー:** \`${key}\`\n\n以下のコマンドでライセンスを有効化してください：\n\`/license activate key:${key}\``,
                    color: 0x2ecc71,
                    footer: { text: 'Akatsuki License System' },
                    timestamp: new Date().toISOString()
                };

                const components = [];
                if (portalUrl) {
                    components.push(new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('ポータルで管理する')
                            .setURL(portalUrl)
                            .setStyle(ButtonStyle.Link)
                    ));
                }

                await user.send({ embeds: [welcomeEmbed], components }).catch(err => {
                    console.warn(`[AppService] Failed to send DM to ${app.author_id}:`, err.message);
                });
            }
        } catch (dmErr) {
            console.error('[AppService] DM error:', dmErr);
        }
    }

    return { success: true, key, tier };
}

module.exports = { saveApplication, approveApplication, checkAutoApproval };
