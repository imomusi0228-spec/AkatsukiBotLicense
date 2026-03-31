// filename: src/bot/commands/activate.js
const { SlashCommandBuilder } = require('discord.js');
const { getOrderByNumber, markOrderUsed } = require('../../services/orderService');
const { createLicenseFromOrder } = require('../../services/licenseService');
const { assignPlanRole } = require('../../services/roleService');
const { formatExpiry } = require('../../utils/date');
const { PLANS } = require('../../constants/plans');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('activate')
        .setDescription('BOOTHの注文番号を使ってライセンスを有効化します')
        .addStringOption(option => 
            option.setName('order_number')
                .setDescription('BOOTHの注文番号（数字のみ）を入力してください')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('token')
                .setDescription('DMで届いた「トークン」を入力してください')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('buyer_name')
                .setDescription('トークンがない場合は、購入者名を入力してください')
                .setRequired(false)),

    async execute(interaction) {
        const orderNumber = interaction.options.getString('order_number');
        const token = interaction.options.getString('token');
        const buyerName = interaction.options.getString('buyer_name');
        const discordId = interaction.user.id;
        const db = require('../../config/database');

        await interaction.deferReply({ ephemeral: true });

        // --- Maintenance Check & Violation Logging ---
        const maintRes = await db.query("SELECT value FROM bot_system_settings WHERE key = 'maintenance_mode'");
        const isMaint = maintRes.rows.length > 0 ? maintRes.rows[0].value === 'true' : false;

        if (isMaint) {
            // Check if admin
            const allowedIds = (process.env.ADMIN_DISCORD_IDS || '').split(',').map(id => id.trim());
            if (!allowedIds.includes(discordId)) {
                // 1. Log Violation & Update last_anomaly_at (Resets recovery timer)
                await db.query(
                    "INSERT INTO operation_logs (action_type, operator_id, operator_name, target_id, details) VALUES ($1, $2, $3, $4, $5)",
                    ['MAINTENANCE_VIOLATION', discordId, interaction.user.tag, 'SYSTEM', 'メンテナンス中の強行アクティベート試行']
                );
                await db.query(`
                    INSERT INTO bot_system_settings (key, value) VALUES ('last_anomaly_at', CURRENT_TIMESTAMP::text)
                    ON CONFLICT (key) DO UPDATE SET value = CURRENT_TIMESTAMP::text
                `);

                // 2. Count violations since maintenance started
                const limitRes = await db.query(`
                    SELECT COUNT(*) as count FROM operation_logs 
                    WHERE action_type = 'MAINTENANCE_VIOLATION' 
                    AND operator_id = $1 
                    AND created_at >= (
                        SELECT COALESCE((SELECT created_at FROM operation_logs WHERE action_type = 'AUTO_BLOCK' OR action_type = 'MAINTENANCE_START' ORDER BY created_at DESC LIMIT 1), '1970-01-01'::timestamp)
                    )
                `, [discordId]);
                
                const violationCount = parseInt(limitRes.rows[0].count);

                if (violationCount >= 3) {
                    const reason = `[AUTO-BLOCK] メンテナンス中の度重なる警告無視 (${violationCount}回目)`;
                    await db.query(
                        'INSERT INTO blacklist (target_id, type, reason, operator_id) VALUES ($1, $2, $3, $4) ON CONFLICT (target_id) DO UPDATE SET reason = EXCLUDED.reason',
                        [discordId, 'user', reason, 'SYSTEM']
                    );
                    return await interaction.editReply({
                        content: '⚠️ **【警告】**度重なる警告を無視してコマンドを試行したため、あなたを**ブラックリスト**に登録しました。\n以降、このボットの全ての機能は利用できません。復旧をご希望の場合は管理者へ直接ご連絡ください。'
                    });
                } else {
                    return await interaction.editReply({
                        content: `❌ **現在メンテナンス中です。**\n緊急メンテナンスのため、コマンドの実行は制限されています。復旧までしばらくお待ちください (${violationCount}/2 回猶予中)\n\n※さらに試行を続けると、システムが悪意あるアクセスと判断して**ブラックリスト**に登録される可能性がございます。`
                    });
                }
            }
        }

        try {
            // トランザクション内で一括処理（ロック、バリデーション、ライセンス発行、使用済みマーク）
            const { activateOrderInTransaction } = require('../../services/orderService');
            const { assignPlanRole } = require('../../services/roleService');
            
            const license = await activateOrderInTransaction({ orderNumber, token, buyerName, discordId });

            // 成功後のロール付与（Discord APIは外部通信のためトランザクション外で行う）
            const member = interaction.member;
            if (member) {
                await assignPlanRole(member, license.plan_type);
            }

            // 5. 成功メッセージの作成
            const plan = PLANS[license.tier] || { displayName: license.tier, maxServers: '?' };
            
            // 有効期限の計算（もしdurationがあれば）
            const usedAt = new Date(license.used_at);
            const expiryDate = license.duration_months ? new Date(usedAt.setMonth(usedAt.getMonth() + license.duration_months)) : null;
            const expiryStr = expiryDate ? `<t:${Math.floor(expiryDate.getTime() / 1000)}:D>` : '無期限';
            
            const serverLimit = plan.maxServers === -1 ? '無制限' : plan.maxServers;

            await interaction.editReply({
                content: `✨ **認証に成功しました！**\n\n` +
                         `🔑 **ライセンスキー:** \`${license.key_id}\`\n` +
                         `📦 **プラン:** \`${plan.displayName}\`\n` +
                         `🖥️ **デバイス上限:** ${serverLimit}\n` +
                         `📅 **想定有効期限:** ${expiryStr}\n\n` +
                         `※このキーは大切に保管してください。`
            });

        } catch (error) {
            logger.error('[Bot] Activate command error:', error);
            
            let errorMessage = '❌ エラーが発生しました。管理者にお問い合わせください。';
            
            if (error.message === 'ORDER_NOT_FOUND') {
                errorMessage = '❌ 注文番号が見つかりません。入力内容をご確認ください。';
            } else if (error.message === 'TOKEN_MISMATCH') {
                errorMessage = '❌ トークンが一致しません。DMで届いた正しいトークンを入力してください。\n\n💡 **トークンの再発行・照会はこちら:**\nhttps://akatsukibot-license.duckdns.org/lookup.html';
            } else if (error.message === 'NAME_MISMATCH') {
                errorMessage = '❌ 購入者名が一致しません。BOOTHの画面に表示されている名前を入力してください。';
            } else if (error.message === 'VERIFICATION_REQUIRED') {
                errorMessage = '❌ 照合情報が不足しています。トークンまたは購入者名のいずれかを入力してください。';
            } else if (error.message === 'ORDER_ALREADY_USED') {
                errorMessage = '⚠️ この注文番号はすでに使用済みです。';
            }

            await interaction.editReply(errorMessage);
        }
    },
};
