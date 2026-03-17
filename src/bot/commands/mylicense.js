// filename: src/bot/commands/mylicense.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLicensesByDiscordId } = require('../../services/licenseService');
const { formatExpiry } = require('../../utils/date');
const { PLANS } = require('../../constants/plans');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mylicense')
        .setDescription('所有しているライセンスの一覧を表示します'),

    async execute(interaction) {
        const discordId = interaction.user.id;

        try {
            const licenses = await getLicensesByDiscordId(discordId);

            if (licenses.length === 0) {
                return await interaction.reply({ content: '現在、有効化されているライセンスはありません。', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle('📋 あなたのライセンス一覧')
                .setColor('#2F3136')
                .setTimestamp();

            for (const lic of licenses) {
                const plan = PLANS[lic.plan_type] || { displayName: lic.plan_type };
                const expiry = formatExpiry(lic.expires_at);
                const status = lic.is_active ? (lic.revoked_at ? '❌ 失効' : '✅ 有効') : '⚠️ 無効';
                const devices = lic.max_servers === -1 ? `${lic.activated_servers} / 無制限` : `${lic.activated_servers} / ${lic.max_servers}`;

                embed.addFields({
                    name: `${plan.displayName} (${lic.product_name})`,
                    value: `🔑 **キー:** \`${lic.license_key}\`\n` +
                           `📊 **状態:** ${status}\n` +
                           `📅 **期限:** ${expiry}\n` +
                           `🖥️ **認証数:** ${devices}`,
                    inline: false
                });
            }

            await interaction.reply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            await interaction.reply({ content: 'ライセンス情報の取得中にエラーが発生しました。', ephemeral: true });
        }
    },
};
