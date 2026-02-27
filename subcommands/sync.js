const { syncSubscriptions } = require('../sync');
const { MessageFlags } = require('discord.js');

module.exports = async (interaction) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const allowedIds = (process.env.ADMIN_DISCORD_IDS || '').split(',').map(id => id.trim());
    const isExplicitAdmin = allowedIds.includes(interaction.user.id);
    const hasDiscordAdmin = interaction.member && interaction.member.permissions.has(interaction.client.guilds.cache.get(interaction.guildId)?.roles.everyone.permissions.constructor.Flags.Administrator);
    // Note: For simplicity, use the targetUserId logic.
    const isAdmin = isExplicitAdmin || (interaction.member && interaction.member.permissions.has('Administrator'));

    // If not admin, only sync themselves to save resources
    const targetUserId = isAdmin ? null : interaction.user.id;
    const result = await syncSubscriptions(interaction.client, targetUserId);

    if (result.success) {
        if (targetUserId) {
            await interaction.editReply(result.updated > 0 ? '✅ あなたのステータスを同期しましたわ。反映をお確かめください。' : 'ℹ️ 同期が必要な変更は見つかりませんでしたわ。');
        } else {
            await interaction.editReply(`✅ グローバル同期完了。更新数: ${result.updated}`);
        }
    } else {
        await interaction.editReply(`❌ 同期エラー: ${result.message || '不明なエラー'}`);
    }
};
