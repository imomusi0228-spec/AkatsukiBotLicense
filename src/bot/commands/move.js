// filename: src/bot/commands/move.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../config/database');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('move')
        .setDescription('現在のサーバーのライセンスを解除し、別のサーバーへ移動する準備をします')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        if (!guildId) {
            return await interaction.reply({ content: '❌ このコマンドはサーバー内で実行してください。', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        // --- Maintenance Check & Violation Logging ---
        const maintRes = await db.query("SELECT value FROM bot_system_settings WHERE key = 'maintenance_mode'");
        const isMaint = maintRes.rows.length > 0 ? maintRes.rows[0].value === 'true' : false;

        if (isMaint) {
            // Check if admin (Always allowed)
            const allowedIds = (process.env.ADMIN_DISCORD_IDS || '').split(',').map(id => id.trim());
            if (!allowedIds.includes(userId)) {
                // 1. Log Violation & Update last_anomaly_at
                await db.query(
                    "INSERT INTO operation_logs (action_type, operator_id, operator_name, target_id, details) VALUES ($1, $2, $3, $4, $5)",
                    ['MAINTENANCE_VIOLATION', userId, interaction.user.tag, 'SYSTEM', 'メンテナンス中の強行移転試行']
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
                `, [userId]);
                
                const violationCount = parseInt(limitRes.rows[0].count);

                if (violationCount >= 3) {
                    const reason = `[AUTO-BLOCK] メンテナンス中の度重なる警告無視 (${violationCount}回目)`;
                    await db.query(
                        'INSERT INTO blacklist (target_id, type, reason, operator_id) VALUES ($1, $2, $3, $4) ON CONFLICT (target_id) DO UPDATE SET reason = EXCLUDED.reason',
                        [userId, 'user', reason, 'SYSTEM']
                    );
                    return await interaction.editReply({
                        content: '⚠️ **【警告】**度重なる警告を無視してコマンドを試行したため、あなたを**ブラックリスト**に登録しました。\n以降、このボットの全ての機能は利用できません。'
                    });
                } else {
                    return await interaction.editReply({
                        content: `❌ **現在メンテナンス中につき、サーバー移転は制限されています。**\n復旧までしばらくお待ちください (${violationCount}/2 回猶予中)\n\n※さらに試行を続けると、**ブラックリスト**に登録される可能性がございます。`
                    });
                }
            }
        }

        try {
            // 1. このサーバーにこのユーザーの有効なライセンスがあるか確認
            const res = await db.query(
                'SELECT * FROM subscriptions WHERE user_id = $1 AND guild_id = $2 AND is_active = TRUE',
                [userId, guildId]
            );

            if (res.rows.length === 0) {
                return await interaction.editReply({ 
                    content: '❌ このサーバーにはあなたの有効なライセンスが登録されていません。' 
                });
            }

            const sub = res.rows[0];

            // 2. 引越し制限のチェック（30日間クールダウン）
            const lastMigration = sub.last_migration_at ? new Date(sub.last_migration_at) : null;
            const now = new Date();
            const cooldownDays = 30;

            if (lastMigration && (now.getTime() - lastMigration.getTime()) < cooldownDays * 24 * 60 * 60 * 1000) {
                const nextAvailable = new Date(lastMigration.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
                return await interaction.editReply({ 
                    content: `❌ まだ引越しはできません。前回の引越しから${cooldownDays}日間のクールダウンが必要です。\n次回の引越し可能日: <t:${Math.floor(nextAvailable.getTime() / 1000)}:D>` 
                });
            }

            // 3. ライセンスの解除（is_active = FALSE）
            await db.query(
                'UPDATE subscriptions SET is_active = FALSE, migration_count = migration_count + 1, last_migration_at = CURRENT_TIMESTAMP WHERE id = $1',
                [sub.id]
            );

            await interaction.editReply({ 
                content: '✅ このサーバーのライセンス登録を解除しました。\n新しいサーバーで `/activate` コマンドを実行して、ライセンスを再有効化してください。\n※引越しのクールダウンが開始されました。' 
            });

        } catch (error) {
            logger.error('[Bot] Move command error:', error);
            await interaction.editReply({ content: '❌ 引越し処理中にエラーが発生しました。' });
        }
    },
};
