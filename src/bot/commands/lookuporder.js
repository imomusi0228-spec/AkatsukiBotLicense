// filename: src/bot/commands/lookuporder.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { lookupOrderDetail } = require('../../services/orderService');
const { ADMIN_DISCORD_IDS } = require('../../config/env');
const { formatExpiry } = require('../../utils/date');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lookuporder')
        .setDescription('【管理者専用】注文番号から詳細情報を調査します')
        .addStringOption(option => 
            option.setName('order_number')
                .setDescription('調査する注文番号')
                .setRequired(true)),

    async execute(interaction) {
        if (!ADMIN_DISCORD_IDS.includes(interaction.user.id)) {
            return await interaction.reply({ content: '❌ このコマンドを実行する権限がありません。', ephemeral: true });
        }

        const orderNumber = interaction.options.getString('order_number');

        try {
            const order = await lookupOrderDetail(orderNumber);

            if (!order) {
                return await interaction.reply({ content: '❌ その注文番号のデータは見つかりません。', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle(`🔍 注文照会: ${order.order_number}`)
                .setColor(order.used ? '#FF0000' : '#00FF00')
                .addFields(
                    { name: '商品名', value: order.product_name, inline: false },
                    { name: 'プラン', value: order.plan_type, inline: true },
                    { name: '状態', value: order.used ? `⚠️ 使用済み (ユーザー: <@${order.used_by_discord_id}>)` : '✅ 未使用', inline: true },
                    { name: '購入者メール', value: order.buyer_email || '不明', inline: false },
                    { name: 'メール受信日時', value: order.mail_received_at ? order.mail_received_at.toLocaleString() : '不明', inline: true },
                    { name: 'システム登録日', value: order.created_at.toLocaleString(), inline: true }
                );

            await interaction.reply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            await interaction.reply({ content: '調査中にエラーが発生しました。', ephemeral: true });
        }
    },
};
