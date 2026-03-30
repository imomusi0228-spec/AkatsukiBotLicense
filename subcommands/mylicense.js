const { EmbedBuilder } = require('discord.js');
const db = require('../db');
const { PLANS } = require('../src/constants/plans');

/**
 * /status コマンドハンドラー
 */
module.exports = async (interaction) => {
    const userId = interaction.user.id;

    try {
        // 1. サブスクリプション情報の取得
        // ユーザーが持っている最も上位、または最新の有効なサブスクを取得
        const subRes = await db.query(`
            SELECT tier, is_active, expiry_date, created_at 
            FROM subscriptions 
            WHERE user_id = $1 AND is_active = TRUE
            ORDER BY created_at DESC LIMIT 1
        `, [userId]);

        const subscription = subRes.rows[0];
        const currentTierId = subscription ? subscription.tier : 'FREE';

        // 2. プラン定数の特定
        // IDまたは表示名でマッチングを試みる
        const plan = Object.values(PLANS).find(p => p.id === currentTierId || p.displayName === currentTierId) || PLANS.FREE;

        // 3. サーバー使用状況の取得
        const licRes = await db.query(`
            SELECT COUNT(*) as count 
            FROM licenses 
            WHERE discord_id = $1 AND is_active = TRUE
        `, [userId]);
        const activeServerCount = parseInt(licRes.rows[0].count || '0');

        // 4. Embedの作成
        const embed = new EmbedBuilder()
            .setTitle('🎫 所有ライセンス一覧')
            .setColor(plan.priority >= 3 ? 0xffd700 : 0x3498db)
            .setThumbnail(interaction.user.displayAvatarURL())
            .addFields(
                { name: '👤 ユーザー', value: `${interaction.user.tag}`, inline: true },
                { name: '💎 現在のプラン', value: `**${plan.displayName}**`, inline: true },
                { name: '📅 有効期限', value: subscription && subscription.expiry_date 
                    ? `<t:${Math.floor(new Date(subscription.expiry_date).getTime() / 1000)}:D> (<t:${Math.floor(new Date(subscription.expiry_date).getTime() / 1000)}:R>)` 
                    : (plan.id === 'ULTIMATE' ? '無期限' : 'なし'), inline: false }
            );

        // サーバー枠の表示
        const maxServersDisp = plan.maxServers === -1 ? '無制限' : `${plan.maxServers}台`;
        embed.addFields({ 
            name: '🖥️ サーバー登録枠', 
            value: `${activeServerCount} / ${maxServersDisp}`, 
            inline: true 
        });

        if (!subscription && plan.id === 'FREE') {
            embed.setDescription('現在、有効な有料ライセンスは確認できませんでした。\nBOOTHで購入後に `/activate` で有効化してください。');
        }

        await interaction.reply({ embeds: [embed] });

    } catch (error) {
        console.error('[MyLicense] Error fetching status:', error);
        await interaction.reply({ content: 'ライセンス情報の取得中にエラーが発生しました。', ephemeral: true });
    }
};
