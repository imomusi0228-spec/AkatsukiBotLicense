// filename: src/bot/commands/portal.js
const { SlashCommandBuilder } = require('discord.js');
const { PUBLIC_URL } = require('../../config/env');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('portal')
        .setDescription('購入者向けセルフポータルのリンクを表示します'),

    async execute(interaction) {
        const portalUrl = PUBLIC_URL || 'https://akatsukibot-license.duckdns.org/';
        
        await interaction.reply({
            content: `🌐 **購入者様向けセルフポータル**\n\nライセンスの管理、キーの再確認、および自動連携設定はこちらから行えます。\n\n🔗 ${portalUrl}`,
            ephemeral: true
        });
    },
};
