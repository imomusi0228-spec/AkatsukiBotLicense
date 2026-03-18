const db = require('../db');
const { MessageFlags } = require('discord.js');
require('dotenv').config();

const ROLES = {
    'ProMonthly': process.env.ROLE_PRO_MONTHLY,
    'ProYearly': process.env.ROLE_PRO_YEARLY,
    'ProPlusMonthly': process.env.ROLE_PRO_PLUS_MONTHLY,
    'ProPlusYearly': process.env.ROLE_PRO_PLUS_YEARLY
};

const isProPlus = (t) => {
    if (!t) return false;
    const s = String(t).toLowerCase();
    return s === 'pro+' || s === '3' || s === '4' || s === 'trial pro+' || s === 'ultimate';
};
const isUltimate = (t) => String(t || '').toUpperCase() === 'ULTIMATE';

module.exports = async (interaction) => {
    // 1. Defer the reply immediately to prevent "Unknown interaction" timeout errors (3s limit)
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const inputServerId = interaction.options.getString('guild_id');
    const inputKey = interaction.options.getString('key');
    const guildId = inputServerId ? inputServerId.trim() : interaction.guildId;
    const userId = interaction.user.id;

    if (!guildId) {
        return interaction.editReply({ content: '❌ サーバーIDを指定するか、サーバー内でコマンドを実行してください。' });
    }

    if (!/^\d{17,20}$/.test(guildId)) {
        return interaction.editReply({ content: '❌ **無効なサーバーIDです。**\n正しいIDを入力してください。' });
    }

    let tier = null;
    let durationMonths = 0;
    let durationDays = 0;
    let usedKey = null;

    // Fetch existing subscriptions for this user first
    const existingResult = await db.query('SELECT * FROM subscriptions WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at ASC', [userId]);
    const existingSubs = existingResult.rows;

    if (!inputKey) {
        if (existingSubs.length === 0) {
            return interaction.editReply({ content: '❌ **ライセンスキーを入力してください。**\n新規登録の場合はBOOTHで送られたキーが必要です。' });
        }
        
        let highestSub = existingSubs[0];
        for (const sub of existingSubs) {
            if (isUltimate(sub.tier)) {
                highestSub = sub;
                break;
            } else if (isProPlus(sub.tier) && !isProPlus(highestSub.tier)) {
                highestSub = sub;
            }
        }
        
        tier = highestSub.tier;
        durationMonths = 0; 
        durationDays = 0;
    }

    // --- 1. Key Verification ---
    if (inputKey) {
        try {
            const trimmedKey = inputKey.trim().toUpperCase();
            const keyCheck = await db.query('SELECT * FROM license_keys WHERE key_id = $1', [trimmedKey]);

            if (keyCheck.rows.length > 0) {
                const row = keyCheck.rows[0];

                if (row.is_used) {
                    return interaction.editReply({ content: '❌ **このライセンスキーは既に使用済みです。**\n一度使ったキーは再利用できません。' });
                }

                // Restriction Check
                if (row.reserved_user_id && row.reserved_user_id !== userId) {
                    return interaction.editReply({
                        content: '❌ **このライセンスキーは他のユーザー専用に発行されています。**\n申請した本人のアカウントで実行してください。'
                    });
                }

                // Normalize tier casing
                const lowerTier = row.tier ? row.tier.toLowerCase() : '';
                if (lowerTier === 'pro') tier = 'Pro';
                else if (lowerTier === 'pro+') tier = 'Pro+';
                else if (lowerTier === 'trial pro') tier = 'Trial Pro';
                else if (lowerTier === 'trial pro+') tier = 'Trial Pro+';
                else tier = row.tier; // Fallback

                durationMonths = row.duration_months;
                durationDays = row.duration_days;
                usedKey = row.key_id;
            } else {
                return interaction.editReply({ content: '❌ **無効なキーまたは注文番号です。**\n入力が間違っている可能性があります。' });
            }
        } catch (err) {
            console.error('[Activate] Key check error:', err);
            return interaction.editReply({ content: 'エラーが発生しました（キー照合失敗）。' });
        }
    }

    if (!tier) {
        return interaction.editReply({
            content: `❌ **有効なサブスクリプションが見つかりませんでした。**\n管理者から発行された正しいキーを入力してください。`
        });
    }

    // Check existing subscriptions for this user
    try {
        const isCurrentServerRegistered = existingSubs.some(s => s.guild_id === guildId);

        if (!isCurrentServerRegistered) {
            // New Quota Logic: 1 User = 1 Tier = Fixed Slots
            let effectiveTier = tier; // This is the tier from the key or highest existing
            
            // Check if any existing sub is better than the one being activated
            existingSubs.forEach(s => {
                if (isUltimate(s.tier)) effectiveTier = 'ULTIMATE';
                else if (isProPlus(s.tier) && !isUltimate(effectiveTier)) effectiveTier = 'Pro+';
            });

            let maxLimit = 1; // Default for Pro
            if (isUltimate(effectiveTier)) maxLimit = 999;
            else if (isProPlus(effectiveTier)) maxLimit = 3;
            else if (String(effectiveTier).startsWith('Trial')) {
                // Trials are typically 1 slot unless specified otherwise
                maxLimit = 1;
            }

            if (existingSubs.length >= maxLimit) {
                return interaction.editReply({
                    content: `❌ **登録制限エラー**\nお使いのプラン構成では最大 ${maxLimit} サーバーまで登録可能です。\n現在の登録数: ${existingSubs.length}\n別のサーバーから移動する場合は、旧サーバーで \`/move\` を実行してください。`
                });
            }
        }

        // Calculate expiry
        let exp = new Date();
        if (tier === 'ULTIMATE') {
            exp = null;
        } else if (inputKey) {
            // New key used
            if (durationDays) {
                exp.setDate(exp.getDate() + durationDays);
            } else {
                exp.setMonth(exp.getMonth() + durationMonths);
            }
        } else {
            // Copied from existing sub, get the one with the furthest expiry
            let furthestExp = existingSubs[0].expiry_date;
            for (const sub of existingSubs) {
                if (sub.expiry_date === null) {
                    furthestExp = null;
                    break;
                }
                if (furthestExp && sub.expiry_date && new Date(sub.expiry_date) > new Date(furthestExp)) {
                    furthestExp = sub.expiry_date;
                }
            }
            exp = furthestExp ? new Date(furthestExp) : null;
        }

        // 2. Perform Upsert for the current server
        await db.query(`
            INSERT INTO subscriptions (guild_id, user_id, tier, expiry_date, is_active, updated_at)
            VALUES ($1, $2, $3, $4, TRUE, NOW())
            ON CONFLICT (guild_id) DO UPDATE 
            SET user_id = EXCLUDED.user_id, 
                tier = EXCLUDED.tier, 
                expiry_date = EXCLUDED.expiry_date, 
                is_active = TRUE,
                updated_at = NOW()
        `, [guildId, userId, tier, exp]);

        // 3. CRITICAL SYNC: Update all other servers for this user to match results
        // This ensures the user's tier and expiry are consistent across their fleet
        await db.query(`
            UPDATE subscriptions SET 
                tier = $1, 
                expiry_date = $2, 
                is_active = TRUE, 
                updated_at = NOW() 
            WHERE user_id = $3
        `, [tier, exp, userId]).catch(err => {
            console.error('[Activate] Bulk update failed:', err);
        });

        if (usedKey) {
            await db.query('UPDATE license_keys SET is_used = TRUE, used_by_user = $1, used_at = CURRENT_TIMESTAMP WHERE key_id = $2', [userId, usedKey]);
        }

        // --- 4. Immediate Role Sync ---
        const { updateMemberRoles } = require('../sync');
        const SUPPORT_GUILD_ID = process.env.SUPPORT_GUILD_ID;
        if (SUPPORT_GUILD_ID) {
            try {
                const supportGuild = await interaction.client.guilds.fetch(SUPPORT_GUILD_ID);
                await updateMemberRoles(supportGuild, userId, tier);
            } catch (err) {
                console.error('[Activate] Failed to sync roles immediately:', err);
            }
        }

        const expiryText = exp ? exp.toLocaleDateString() : '無期限 (ULTIMATE)';
        const portalUrl = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/portal.html` : null;
        let successMsg = `✅ サーバー (ID: ${guildId}) を有効化しました！\n**Tier:** ${tier}\n**有効期限:** ${expiryText}\n**方法:** ${inputKey ? 'ライセンスキー' : '既存プランの追加枠利用'}\n\nサポートサーバーのロールも同期されました。`;

        if (portalUrl) {
            successMsg += `\n\n🌐 **ポータルで管理:**\n<${portalUrl}>`;
        }

        await interaction.editReply({ content: successMsg });

    } catch (err) {
        console.error(err);
        await interaction.editReply({ content: 'エラーが発生しました。管理者に連絡してください。' });
    }
};
