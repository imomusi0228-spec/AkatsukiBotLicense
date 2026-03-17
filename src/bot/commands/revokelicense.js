// filename: src/bot/commands/revokelicense.js
const { SlashCommandBuilder } = require('discord.js');
const { revokeLicense } = require('../../services/licenseService');
const { ADMIN_DISCORD_IDS } = require('../../config/env');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('revokelicense')
        .setDescription('【管理者専用】ライセンスを無効化（失効）させます')
        .addStringOption(option => 
            option.setName('license_key')
                .setDescription('無効化するライセンスキー')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('無効化の理由')
                .setRequired(false)),

    async execute(interaction) {
        // 管理者権限チェック
        if (!ADMIN_DISCORD_IDS.includes(interaction.user.id)) {
            return await interaction.reply({ content: '❌ このコマンドを実行する権限がありません。', ephemeral: true });
        }

        const licenseKey = interaction.options.getString('license_key');
        const reason = interaction.options.getString('reason') || '管理者による無効化';

        await interaction.deferReply({ ephemeral: true });

        try {
            const result = await revokeLicense({
                licenseKey,
                reason,
                actorId: interaction.user.id
            });

            if (result) {
                await interaction.editReply(`✅ ライセンス \`${licenseKey}\` を無効化しました。\n理由: ${reason}`);
            } else {
                await interaction.editReply('❌ ライセンスが見つかりません。');
            }
        } catch (error) {
            await interaction.editReply('❌ 処理中にエラーが発生しました。');
        }
    },
};
