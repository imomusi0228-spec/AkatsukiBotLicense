// filename: src/bot/commands/sync.js
const { SlashCommandBuilder } = require('discord.js');
const { getLicensesByDiscordId } = require('../../services/licenseService');
const { assignPlanRole } = require('../../services/roleService');
const { PLANS } = require('../../constants/plans');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sync')
        .setDescription('ユーザーのライセンス状態を確認し、Discordロールを最新の状態に同期します'),

    async execute(interaction) {
        const userId = interaction.user.id;
        const member = interaction.member;

        if (!member) {
            return await interaction.reply({ content: '❌ このコマンドはサーバー内でのみ実行可能です。', ephemeral: true });
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            // 1. ライセンス一覧の取得
            const licenses = await getLicensesByDiscordId(userId);
            
            // 有効なライセンスに絞り込む
            const activeLicenses = licenses.filter(lic => lic.is_active && (!lic.expires_at || new Date(lic.expires_at) > new Date()));

            if (activeLicenses.length === 0) {
                // 有料ライセンスがない場合はFREE扱いで同期
                await assignPlanRole(member, PLANS.FREE.id);
                return await interaction.editReply({
                    content: '✅ 同期が完了しました。現在、有効な有料ライセンスは確認されなかったため、FREEロールが適用されました。'
                });
            }

            // 2. 最上位プランの特定 (priorityが最も高いものを探す)
            let bestPlanType = PLANS.FREE.id;
            let maxPriority = -1;

            for (const lic of activeLicenses) {
                const plan = PLANS[lic.plan_type];
                if (plan && plan.priority > maxPriority) {
                    maxPriority = plan.priority;
                    bestPlanType = lic.plan_type;
                }
            }

            // 3. ロールの付与
            await assignPlanRole(member, bestPlanType);

            const bestPlan = PLANS[bestPlanType];
            await interaction.editReply({
                content: `✅ 同期が完了しました。\n現在の最上位ライセンス: **${bestPlan.displayName}** としてロールを更新しました。`
            });

        } catch (error) {
            logger.error('[Bot] Sync command error:', error);
            await interaction.editReply({ content: '❌ 同期処理中にエラーが発生しました。' });
        }
    },
};
