// filename: src/bot/commands/mylicense.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLicensesByDiscordId } = require('../../services/licenseService');
const logger = require('../../utils/logger');
const { PLANS } = require('../../constants/plans');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mylicense')
        .setDescription('あなたが所有しているライセンスと現在の有効化状況を確認します'),

    async execute(interaction) {
        const userId = interaction.user.id;

        try {
            await interaction.deferReply({ ephemeral: true });

            // 1. ライセンス情報の取得 (ownedKeys, activeSubscriptions)
            const licenseData = await getLicensesByDiscordId(userId);
            const { ownedKeys, activeSubscriptions } = licenseData;

            if (ownedKeys.length === 0 && activeSubscriptions.length === 0) {
                return await interaction.editReply({ 
                    content: '❌ 所有されているライセンス情報は、現在のデータベースには見つかりませんでした。' 
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('💎 所有ライセンス・有効化状況')
                .setColor(0x00AE86)
                .setTimestamp()
                .setFooter({ text: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() });

            // 2. 所有ライセンスキーの表示
            if (ownedKeys.length > 0) {
                const keyList = ownedKeys.map(k => {
                    const plan = PLANS[k.tier] || { displayName: k.tier };
                    return `🔑 \`${k.key_id}\` (${plan.displayName})\n└ 状態: ${k.is_used ? '使用済' : '未使用'}`;
                }).join('\n\n');
                embed.addFields({ name: '🔐 所有ライセンスキー', value: keyList || 'なし' });
            }

            // 3. 有効化中サーバーの表示
            if (activeSubscriptions.length > 0) {
                const subList = activeSubscriptions.map(s => {
                    const plan = PLANS[s.tier] || { displayName: s.tier };
                    const expiry = s.valid_until ? `<t:${Math.floor(new Date(s.valid_until).getTime() / 1000)}:D>` : '無期限';
                    return `🖥️ **Server ID:** \`${s.guild_id}\`\n└ プラン: ${plan.displayName}\n└ 期限: ${expiry}`;
                }).join('\n\n');
                embed.addFields({ name: '🌐 有効化中のサーバー', value: subList || 'なし' });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error('[Bot] MyLicense command error:', error);
            await interaction.editReply({ content: '❌ ライセンス情報の取得中にエラーが発生しました。データベースの稼働状況を確認します。' });
        }
    },
};
