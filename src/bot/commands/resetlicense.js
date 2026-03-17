// filename: src/bot/commands/resetlicense.js
const { SlashCommandBuilder } = require('discord.js');
const { resetLicenseActivations } = require('../../services/licenseService');
const { ADMIN_DISCORD_IDS } = require('../../config/env');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resetlicense')
        .setDescription('【管理者専用】ライセンスのデバイス認証をすべてリセットします')
        .addStringOption(option => 
            option.setName('license_key')
                .setDescription('リセットするライセンスキー')
                .setRequired(true)),

    async execute(interaction) {
        if (!ADMIN_DISCORD_IDS.includes(interaction.user.id)) {
            return await interaction.reply({ content: '❌ このコマンドを実行する権限がありません。', ephemeral: true });
        }

        const licenseKey = interaction.options.getString('license_key');

        await interaction.deferReply({ ephemeral: true });

        try {
            const success = await resetLicenseActivations(licenseKey, interaction.user.id);
            if (success) {
                await interaction.editReply(`✅ ライセンス \`${licenseKey}\` の全デバイス認証を解除しました。`);
            } else {
                await interaction.editReply('❌ ライセンスが見つかりません。');
            }
        } catch (error) {
            await interaction.editReply('❌ 処理中にエラーが発生しました。');
        }
    },
};
