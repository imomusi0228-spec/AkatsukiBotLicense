const { saveApplication } = require('../services/applicationService');
const { MessageFlags } = require('discord.js');

/**
 * Handles messages in the #ライセンス申請 channel
 */
async function handleApplicationMessage(message, client) {
    if (message.channel.id !== process.env.APPLICATION_CHANNEL_ID) return;
    if (message.author.bot) return;

    const parsed = parseApplication(message.content);
    if (!parsed) return;

    try {
        await saveApplication({
            messageId: message.id,
            channelId: message.channel.id,
            authorId: message.author.id,
            authorName: message.author.tag,
            content: message.content,
            userId: parsed.userId,
            guildId: parsed.guildId,
            tier: parsed.tier,
            boothName: parsed.boothName,
            sourceType: 'message'
        }, client);

        await message.react('👀').catch(() => { });
    } catch (err) {
        console.error('[App] Error saving application via message:', err);
    }
}

function parseApplication(content) {
    const boothMatch = content.match(/購入者名[(（]BOOTH[)）][:：]\s*(.+)/);
    const userMatch = content.match(/ユーザーID[:：]\s*(\d+)/);
    const serverMatch = content.match(/サーバーID[:：]\s*(\d+)/);
    const tierMatch = content.match(/希望プラン[(（]Pro\s*[\/\s]*Pro\+\s*[\/\s]*ULTIMATE[)）][:：]\s*((?:Trial\s+)?Pro\+?|ULTIMATE)/i);

    if (!userMatch || !serverMatch || !tierMatch) return null;

    const rawTier = tierMatch[1].trim();
    let tier = rawTier;
    if (rawTier.toLowerCase() === 'pro') tier = 'Pro';
    else if (rawTier.toLowerCase() === 'pro+') tier = 'Pro+';
    else if (rawTier.toLowerCase() === 'trial pro') tier = 'Trial Pro';
    else if (rawTier.toLowerCase() === 'trial pro+') tier = 'Trial Pro+';
    else if (rawTier.toLowerCase() === 'ultimate') tier = 'ULTIMATE';

    return {
        boothName: boothMatch ? boothMatch[1].trim() : 'Unknown',
        userId: userMatch[1].trim(),
        guildId: serverMatch[1].trim(),
        tier: tier
    };
}

async function handleApplicationModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const boothName = interaction.fields.getTextInputValue('booth_name');
    const boothOrderId = interaction.fields.getTextInputValue('booth_order_id') || null;
    const userId = interaction.fields.getTextInputValue('user_id');
    const guildId = interaction.fields.getTextInputValue('guild_id');
    const tierRaw = interaction.customId.split(':')[1] || 'Pro';

    let tier = tierRaw;
    if (tierRaw.toLowerCase() === 'pro') tier = 'Pro';
    else if (tierRaw.toLowerCase() === 'pro+') tier = 'Pro+';
    else if (tierRaw.toLowerCase() === 'trial pro') tier = 'Trial Pro';
    else if (tierRaw.toLowerCase() === 'trial pro+') tier = 'Trial Pro+';
    else if (tierRaw.toLowerCase() === 'ultimate') tier = 'ULTIMATE';

    try {
        const result = await saveApplication({
            messageId: `modal-${interaction.id}`,
            channelId: interaction.channel.id,
            authorId: interaction.user.id,
            authorName: interaction.user.tag,
            content: `Modal Submission: ${boothName} / ${tier}`,
            userId: userId,
            guildId: guildId,
            tier: tier,
            boothName: boothName,
            boothOrderId: boothOrderId,
            sourceType: 'modal'
        }, interaction.client);

        let replyMsg = '✅ **申請を受け付けました！**\n内容を精査し、不備がなければライセンスを発行いたします。';
        if (result.auto_processed) {
            replyMsg = result.tier === 'ULTIMATE' 
                ? '⚡ **ULTIMATEライセンスを自動有効化しました！**\nお嬢様、永久ライセンスのご利用ありがとうございます！'
                : '⚡ **自動発行・承認が完了しました！**\nライセンスキーをWebhookまたはDMで送信しましたので、ご確認ください。';
        } else if (result.auto_rejected) {
            replyMsg = '⚠️ **トライアルは既に利用済みです**\nトライアルは1回限りの提供となっております。引き続きご利用いただく場合は、有料プランをご検討ください。';
        }

        await interaction.editReply({
            content: replyMsg
        });
    } catch (err) {
        console.error('[App] Modal Save Error:', err);
        await interaction.editReply({
            content: '❌ 申請の保存中にエラーが発生しました。時間を置いて再度お試しください。'
        }).catch(() => { });
    }
}

module.exports = { handleApplicationMessage, handleApplicationModal };
