const db = require('../db');
const { MessageFlags } = require('discord.js');

module.exports = async (interaction) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    if (!guildId) {
        return interaction.editReply('❌ このコマンドはサーバー内で実行してください。');
    }

    try {
        // 1. Check if the user has an active subscription in THIS server
        const res = await db.query(
            'SELECT * FROM subscriptions WHERE user_id = $1 AND guild_id = $2 AND is_active = TRUE',
            [userId, guildId]
        );

        if (res.rows.length === 0) {
            return interaction.editReply('❌ このサーバーにはあなたの有効なライセンスが登録されていません。');
        }

        const sub = res.rows[0];

        // 2. Check migration limits (30 days cooldown)
        const lastMigration = sub.last_migration_at ? new Date(sub.last_migration_at) : null;
        const now = new Date();
        const cooldownDays = 30;

        if (lastMigration && (now - lastMigration) < cooldownDays * 24 * 60 * 60 * 1000) {
            const nextAvailable = new Date(lastMigration.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
            return interaction.editReply(`❌ まだ引越しはできません。前回の引越しから${cooldownDays}日間のクールダウンが必要です。\n次回の引越し可能日: ${nextAvailable.toLocaleDateString()}`);
        }

        // 3. Deactivate current subscription (soft delete or set is_active=false)
        // We'll set is_active = FALSE so they can re-activate elsewhere
        await db.query(
            'UPDATE subscriptions SET is_active = FALSE, migration_count = migration_count + 1, last_migration_at = CURRENT_TIMESTAMP WHERE guild_id = $1',
            [guildId]
        );

        // 4. Role Sync (Skip)
        // In user-based model, we don't downgrade roles just because one server moved.
        // The user still maintains their tier until expiry.
        /* 
        const { updateMemberRoles } = require('../sync');
        ...
        */

        await interaction.editReply('✅ このサーバーのライセンス登録を解除しました。\n新しいサーバーで `/activate` コマンドを実行してライセンスを再有効化してください。\n※引越しの統計としてカウントされました。');

    } catch (err) {
        console.error('[Move] Error:', err);
        await interaction.editReply('エラーが発生しました。管理者に連絡してください。');
    }
};
