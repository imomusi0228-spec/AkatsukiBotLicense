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
                .setDescription('BOOTHの注文番号（数字のみ）を入力してください')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('token')
                .setDescription('DMで届いた「トークン」を入力してください')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('buyer_name')
                .setDescription('トークンがない場合は、購入者名を入力してください')
                .setRequired(false)),

    async execute(interaction) {
        const orderNumber = interaction.options.getString('order_number');
        const token = interaction.options.getString('token');
        const buyerName = interaction.options.getString('buyer_name');
        const discordId = interaction.user.id;

        await interaction.deferReply({ ephemeral: true });

        try {
            // トランザクション内で一括処理（ロック、バリデーション、ライセンス発行、使用済みマーク）
            const { activateOrderInTransaction } = require('../../services/orderService');
            const { assignPlanRole } = require('../../services/roleService');
            
            const license = await activateOrderInTransaction({ orderNumber, token, buyerName, discordId });

            // 成功後のロール付与（Discord APIは外部通信のためトランザクション外で行う）
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
            
            let errorMessage = '❌ エラーが発生しました。管理者にお問い合わせください。';
            
            if (error.message === 'ORDER_NOT_FOUND') {
                errorMessage = '❌ 注文番号が見つかりません。入力内容をご確認ください。';
            } else if (error.message === 'TOKEN_MISMATCH') {
                errorMessage = '❌ トークンが一致しません。DMで届いた正しいトークンを入力してください。\n\n💡 **トークンの再発行・照会はこちら:**\nhttps://akatsukibot-license.duckdns.org/lookup.html';
            } else if (error.message === 'NAME_MISMATCH') {
                errorMessage = '❌ 購入者名が一致しません。BOOTHの画面に表示されている名前を入力してください。';
            } else if (error.message === 'VERIFICATION_REQUIRED') {
                errorMessage = '❌ 照合情報が不足しています。トークンまたは購入者名のいずれかを入力してください。';
            } else if (error.message === 'ORDER_ALREADY_USED') {
                errorMessage = '⚠️ この注文番号はすでに使用済みです。';
            }

            await interaction.editReply(errorMessage);
        }
    },
};
