const { getOrderByNumber, markOrderUsed, activateOrderInTransaction } = require('../src/services/orderService');
const { assignPlanRole } = require('../src/services/roleService');
const { formatExpiry } = require('../src/utils/date');
const { PLANS } = require('../src/constants/plans');
const logger = require('../src/utils/logger');
const { MessageFlags } = require('discord.js');

module.exports = async (interaction) => {
    const orderNumber = interaction.options.getString('order_number');
    const token = interaction.options.getString('token');
    const buyerName = interaction.options.getString('buyer_name');
    const discordId = interaction.user.id;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        // 1. トランザクション内で一括アクティベーション
        const license = await activateOrderInTransaction({ orderNumber, token, buyerName, discordId });

        // 2. ロール付与 (Support Server)
        const member = interaction.member;
        if (member) {
            await assignPlanRole(member, license.plan_type);
        }

        // 3. 成功メッセージ
        const plan = PLANS[license.plan_type] || { displayName: license.plan_type, maxServers: '?' };
        const expiryStr = formatExpiry(license.expires_at);
        const serverLimit = plan.maxServers === -1 ? '無制限' : plan.maxServers;

        await interaction.editReply({
            content: `✨ **認証に成功しました！**\n\n` +
                     `📦 **プラン:** \`${plan.displayName}\`\n` +
                     `🖥️ **デバイス上限:** ${serverLimit}\n` +
                     `📅 **有効期限:** ${expiryStr}\n\n` +
                     `※ポータルから詳細を確認・管理いただけます。\nhttps://akatsukibot-license.duckdns.org/portal.html`
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
};
