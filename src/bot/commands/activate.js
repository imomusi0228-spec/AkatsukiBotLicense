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
                .setDescription('BOOTHの注文番号を入力してください')
                .setRequired(true)),

    async execute(interaction) {
        const orderNumber = interaction.options.getString('order_number');
        const discordId = interaction.user.id;

        await interaction.deferReply({ ephemeral: true });

        try {
            // 1. 注文情報の確認
            const order = await getOrderByNumber(orderNumber);

            if (!order) {
                return await interaction.editReply('❌ 注文番号が見つかりません。入力内容をご確認いただくか、購入直後の場合は数分待ってから再度お試しください。');
            }

            if (order.used) {
                return await interaction.editReply('⚠️ この注文番号はすでに使用済みです。');
            }

            // 2. ライセンスの発行
            const license = await createLicenseFromOrder(order, discordId);

            if (!license) {
                throw new Error('License creation failed');
            }

            // 3. 注文を使用済みに更新
            await markOrderUsed(order.id, discordId);

            // 4. ロール付与
            const member = interaction.member;
            if (member) {
                await assignPlanRole(member, license.plan_type);
            }

            // 5. 成功メッセージの作成
            const plan = PLANS[license.plan_type] || { displayName: license.plan_type, maxServers: '?' };
            const expiryStr = formatExpiry(license.expires_at);
            const serverLimit = plan.maxServers === -1 ? '無制限' : plan.maxServers;

            await interaction.editReply({
                content: `✨ **認証に成功しました！**\n\n` +
                         `🔑 **ライセンスキー:** \`${license.license_key}\`\n` +
                         `📦 **プラン:** \`${plan.displayName}\`\n` +
                         `🖥️ **デバイス上限:** ${serverLimit}\n` +
                         `📅 **有効期限:** ${expiryStr}\n\n` +
                         `※このキーは大切に保管してください。`
            });

        } catch (error) {
            logger.error('[Bot] Activate command error:', error);
            await interaction.editReply('❌ 申し訳ありません。ライセンスの発行中にエラーが発生しました。管理者にお問い合わせください。');
        }
    },
};
