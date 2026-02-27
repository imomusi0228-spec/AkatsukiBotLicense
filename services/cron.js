const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const cron = require('node-cron');
const db = require('../db');
const { updateMemberRoles } = require('../sync');

const TIER_VALUE_FREE = 'Free';
const BOOTH_URL = 'https://imomusi0213.booth.pm/items/7935721';

// Schedule: Run every 6 hours (0 */6 * * *) or for testing, every minute (* * * * *)
const SCHEDULE = '0 * * * *';

function startCron(client) {
    console.log(`[Cron] Scheduled expiry check task (${SCHEDULE})`);

    const EVERY_MINUTE = '* * * * *';
    console.log(`[Cron] Scheduled task runner (${EVERY_MINUTE})`);

    // 1. Hourly Expiry Check & Warnings
    cron.schedule('0 * * * *', async () => {
        console.log('[Cron] Running hourly expiry check...');
        try {
            const dmSettingRes = await db.query("SELECT value FROM bot_system_settings WHERE key = 'dm_reminders_enabled'");
            const dmEnabled = dmSettingRes.rows.length > 0 ? dmSettingRes.rows[0].value === 'true' : true;

            if (dmEnabled) {
                const getTierName = (t) => {
                    if (t === '1' || t === 1) return 'Pro';
                    if (t === '2' || t === 2) return 'Pro (Yearly)';
                    if (t === '3' || t === 3) return 'Pro+';
                    if (t === '4' || t === 4) return 'Pro+ (Yearly)';
                    return t || 'Free';
                };

                const warningTargetsRes = await db.query(`
                    SELECT guild_id, user_id, tier, expiry_date, auto_renew 
                    FROM subscriptions 
                    WHERE is_active = TRUE AND expiry_warning_sent = FALSE 
                    AND (
                        (expiry_date <= NOW() + INTERVAL '7 days' AND tier NOT IN ('Free', '0', 'ULTIMATE') AND tier NOT LIKE 'Trial%')
                        OR (expiry_date <= NOW() + INTERVAL '1 day' AND tier LIKE 'Trial%')
                    )
                `);

                for (const sub of warningTargetsRes.rows) {
                    try {
                        const user = await client.users.fetch(sub.user_id).catch(() => null);
                        if (user) {
                            const tierName = getTierName(sub.tier);
                            const isTrial = String(sub.tier).startsWith('Trial');
                            const description = isTrial
                                ? `ご利用ありがとうございます。お使いの **${tierName}プラン** の有効期限がまもなく終了します。\n継続してご利用いただくには、BOOTHにて有料版の購入をご検討ください。`
                                : `ご利用ありがとうございます。お使いの **${tierName}プラン** の有効期限がまもなく終了します。`;

                            const embed = new EmbedBuilder()
                                .setTitle('📅 サブスクリプション期限のお知らせ')
                                .setDescription(description)
                                .addFields(
                                    { name: 'サーバーID', value: sub.guild_id },
                                    { name: '期限', value: new Date(sub.expiry_date).toLocaleDateString() },
                                    { name: '自動更新', value: sub.auto_renew ? '有効 (自動的に更新されます)' : '無効 (期限後はFreeプランへ移行します)' }
                                )
                                .setColor(sub.auto_renew ? 0x00ff00 : 0xffa500)
                                .setTimestamp();

                            const row = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setLabel('有料版をBOOTHで購入').setStyle(ButtonStyle.Link).setURL(BOOTH_URL)
                            );

                            await user.send({ embeds: [embed], components: [row] }).catch(() => null);
                            await db.query('UPDATE subscriptions SET expiry_warning_sent = TRUE WHERE guild_id = $1', [sub.guild_id]);
                        }
                    } catch (err) { console.error(`[Cron] Expiry Warning Error (${sub.guild_id}):`, err.message); }
                }
            }

            // Process Expired Subscriptions
            const expiredRes = await db.query("SELECT guild_id, user_id, tier, auto_renew FROM subscriptions WHERE is_active = TRUE AND expiry_date <= NOW() AND expiry_date IS NOT NULL");
            for (const sub of expiredRes.rows) {
                if (sub.auto_renew) {
                    const newExpiry = new Date();
                    newExpiry.setMonth(newExpiry.getMonth() + 1);
                    await db.query('UPDATE subscriptions SET expiry_date = $1, expiry_warning_sent = FALSE WHERE guild_id = $2', [newExpiry, sub.guild_id]);
                } else {
                    await db.query('UPDATE subscriptions SET tier = $1, is_active = TRUE, expiry_date = NULL, auto_renew = FALSE WHERE guild_id = $2', [String(TIER_VALUE_FREE), sub.guild_id]);
                    const user = await client.users.fetch(sub.user_id).catch(() => null);
                    if (user) await user.send(`【通知】サブスクリプションの有効期限が終了したため、サーバー (ID: ${sub.guild_id}) をFreeプランへ移行しました。`).catch(() => null);

                    if (process.env.SUPPORT_GUILD_ID) {
                        const supportGuild = await client.guilds.fetch(process.env.SUPPORT_GUILD_ID).catch(() => null);
                        if (supportGuild) await updateMemberRoles(supportGuild, sub.user_id, 'Free');
                    }
                }
            }
        } catch (err) { console.error('[Cron] Hourly Check Error:', err); }
    });

    // 2. Scheduled Announcements: Every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
        try {
            const pendingAnnounce = await db.query("SELECT id, title, content, type FROM scheduled_announcements WHERE sent_at IS NULL AND scheduled_at <= NOW()");
            for (const announce of pendingAnnounce.rows) {
                const channel = await client.channels.fetch(process.env.ANNOUNCEMENT_CHANNEL_ID).catch(() => null);
                if (channel) {
                    const embed = new EmbedBuilder()
                        .setTitle(announce.title).setDescription(announce.content)
                        .setColor(announce.type === 'important' ? 0xff0000 : 0x00ff00).setTimestamp();
                    await channel.send({ embeds: [embed] });
                    await db.query('UPDATE scheduled_announcements SET sent_at = NOW() WHERE id = $1', [announce.id]);
                }
            }
        } catch (err) { console.error('[Cron] Announcement Error:', err); }
    });

    // 3. Daily Update Check: 03:00
    cron.schedule('0 3 * * *', async () => {
        try {
            const { checkForUpdates } = require('./updates');
            await checkForUpdates(client);
        } catch (err) { console.error('[Cron] Update Check Error:', err); }
    });

    // 4. Monthly Statistics Report: 1st of month at 09:00
    cron.schedule('0 9 1 * *', async () => {
        console.log('[Cron] Generating monthly report...');
        try {
            const lastMonth = new Date(); lastMonth.setMonth(lastMonth.getMonth() - 1); lastMonth.setDate(1);
            const thisMonth = new Date(); thisMonth.setDate(1);

            const newAppsRes = await db.query("SELECT COUNT(*) FROM applications WHERE status = 'approved' AND created_at >= $1 AND created_at < $2", [lastMonth, thisMonth]);
            const subsRes = await db.query("SELECT tier, COUNT(*) FROM subscriptions WHERE is_active = TRUE GROUP BY tier");
            const tierStats = subsRes.rows.map(row => `${row.tier}: ${row.count}`).join('\n');

            const reportEmbed = new EmbedBuilder()
                .setTitle('📊 月次レポート通知').setDescription(`${lastMonth.getFullYear()}年${lastMonth.getMonth() + 1}月の運営統計です。`)
                .addFields({ name: '新規承認数', value: `${newAppsRes.rows[0].count} 件`, inline: true }, { name: '現在有効なサブスク', value: subsRes.rows.length > 0 ? tierStats : 'なし' })
                .setColor(0x3498db).setTimestamp();

            const { sendWebhookNotification } = require('./applicationService');
            await sendWebhookNotification({ embeds: [reportEmbed.toJSON()] });

            const adminIds = (process.env.ADMIN_DISCORD_IDS || '').split(',').map(id => id.trim()).filter(id => id);
            for (const adminId of adminIds) {
                const adminUser = await client.users.fetch(adminId).catch(() => null);
                if (adminUser) await adminUser.send({ embeds: [reportEmbed] }).catch(() => null);
            }
        } catch (err) { console.error('[Cron] Monthly Report Error:', err); }
    });
});
}

module.exports = { startCron };
