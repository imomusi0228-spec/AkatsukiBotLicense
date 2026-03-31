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
                    const planRes = Object.values(PLANS).find(p => p.id === t || p.displayName === t);
                    return planRes ? planRes.displayName : t || 'Free';
                };

                // Find targets for 7-day, 3-day, and 1-day warnings
                const warningTargetsRes = await db.query(`
                    SELECT guild_id, user_id, tier, expiry_date, auto_renew, last_warning_days 
                    FROM subscriptions 
                    WHERE is_active = TRUE AND auto_renew = FALSE
                    AND tier NOT IN ('Free', '0', 'ULTIMATE')
                    AND tier NOT LIKE 'Trial%'
                    AND (
                        (expiry_date <= NOW() + INTERVAL '7 days' AND (last_warning_days IS NULL OR last_warning_days > 7))
                        OR (expiry_date <= NOW() + INTERVAL '3 days' AND (last_warning_days IS NULL OR last_warning_days > 3))
                        OR (expiry_date <= NOW() + INTERVAL '1 day' AND (last_warning_days IS NULL OR last_warning_days > 1))
                    )
                `);

                for (const sub of warningTargetsRes.rows) {
                    try {
                        const daysLeft = Math.ceil((new Date(sub.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
                        if (daysLeft < 0) continue; // Already handled by expiry logic

                        const user = await client.users.fetch(sub.user_id).catch(() => null);
                        if (user) {
                            const tierName = getTierName(sub.tier);
                            let title = '📅 サブスクリプション期限のお知らせ';
                            let description = `ご利用ありがとうございます。お使いの **${tierName}プラン** の有効期限がまもなく（あと${daysLeft}日）終了します。`;
                            let color = 0xffa500; // Orange

                            if (daysLeft <= 1) {
                                title = '⚠️ 【重要】サブスクリプション期限のお知らせ';
                                description = `お使いの **${tierName}プラン** の有効期限が**明日**終了します。期限後は1日間の猶予期間を経てFreeプランへ移行されますので、お早めの更新をお勧めします。`;
                                color = 0xff0000; // Red
                            } else if (daysLeft <= 3) {
                                description = `お使いの **${tierName}プラン** の有効期限があと3日となりました。継続してご利用いただく場合は、お早めにBOOTHにてお手続きください。`;
                            }

                            const embed = new EmbedBuilder()
                                .setTitle(title)
                                .setDescription(description)
                                .addFields(
                                    { name: 'サーバーID', value: sub.guild_id },
                                    { name: '期限', value: new Date(sub.expiry_date).toLocaleDateString() },
                                    { name: '自動更新', value: sub.auto_renew ? '有効 (自動的に更新されます)' : '無効 (期限後は猶予期間を経てFreeプランへ移行します)' }
                                )
                                .setColor(color)
                                .setTimestamp();

                            const row = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setLabel('有料版をBOOTHで購入').setStyle(ButtonStyle.Link).setURL(BOOTH_URL)
                            );

                            await user.send({ embeds: [embed], components: [row] }).catch(() => null);
                            await db.query('UPDATE subscriptions SET expiry_warning_sent = TRUE, last_warning_days = $1 WHERE guild_id = $2', [daysLeft, sub.guild_id]);
                        }
                    } catch (err) { console.error(`[Cron] Expiry Warning Error (${sub.guild_id}):`, err.message); }
                }
            }

            // Process Expired Subscriptions (User-Based Sync)
            // Truly Expired = expiry_date + 3 days in the past
            const expiredRes = await db.query(`
                SELECT DISTINCT user_id, tier, auto_renew FROM subscriptions 
                WHERE is_active = TRUE 
                AND expiry_date + INTERVAL '1 day' <= NOW() 
                AND expiry_date IS NOT NULL
            `);
            for (const sub of expiredRes.rows) {
                const userId = sub.user_id;

                if (sub.auto_renew) {
                    const newExpiry = new Date();
                    newExpiry.setMonth(newExpiry.getMonth() + 1);
                    // Extend ALL servers for this user
                    await db.query('UPDATE subscriptions SET expiry_date = $1, expiry_warning_sent = FALSE WHERE user_id = $2', [newExpiry, userId]);
                    console.log(`[Cron] Auto-renewed all servers for User: ${userId}`);
                } else {
                    // Downgrade ALL servers for this user to Free
                    await db.query('UPDATE subscriptions SET tier = $1, is_active = TRUE, expiry_date = NULL, auto_renew = FALSE WHERE user_id = $2', [String(TIER_VALUE_FREE), userId]);
                    
                    const user = await client.users.fetch(userId).catch(() => null);
                    if (user) await user.send(`【重要】有効期限が終了したため、お使いの全てのサーバーをFreeプランへ移行いたしました。継続してご利用いただくには再度アクティベートをお願いいたします。`).catch(() => null);

                    if (process.env.SUPPORT_GUILD_ID) {
                        const supportGuild = await client.guilds.fetch(process.env.SUPPORT_GUILD_ID).catch(() => null);
                        if (supportGuild) await updateMemberRoles(supportGuild, userId, 'Free');
                    }
                    console.log(`[Cron] Expired all servers for User: ${userId}`);
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

    // 3. Weekly Update Announcement: Fridays at 19:00
    cron.schedule('0 19 * * 5', async () => {
        try {
            const { announceWeeklyUpdates } = require('./updates');
            await announceWeeklyUpdates(client);
        } catch (err) { console.error('[Cron] Weekly Update Error:', err); }
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



    // 6. Automated Daily Backup: 03:00
    cron.schedule('0 3 * * *', async () => {
        console.log('[Cron] Running scheduled daily backup...');
        try {
            const { performBackup, cleanupOldBackups } = require('./backupService');
            await performBackup();
            const removed = await cleanupOldBackups(30);
            console.log(`[Cron] Backup completed. Removals: ${removed}`);
        } catch (err) { console.error('[Cron] Auto-backup Error:', err); }
    });

    // 7. Hourly Anomaly Detection & Auto-Lock: Hourly (0 * * * *)
    cron.schedule('0 * * * *', async () => {
        console.log('[Cron] Running anomaly detection check...');
        try {
            const THRESHOLD = 10; // 個別ベース(User/IP)での制限件数
            const query = `
                SELECT operator_id, operator_name, ip_address, COUNT(*) as activation_count
                FROM operation_logs
                WHERE action_type = 'activate' AND created_at >= NOW() - INTERVAL '1 hour'
                GROUP BY operator_id, operator_name, ip_address
                HAVING COUNT(*) >= $1
            `;
            const result = await db.query(query, [THRESHOLD]);

            if (result.rows.length > 0) {
                const culprits = result.rows;
                console.warn(`[Cron] ANOMALY DETECTED: ${culprits.length} group(s) exceeded threshold! Locking system.`);
                
                // 1. Activate Kill Switch (Maintenance Mode)
                await db.query(`
                    INSERT INTO bot_system_settings (key, value) VALUES ('maintenance_mode', 'true'), ('last_anomaly_at', CURRENT_TIMESTAMP::text)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                `);
                
                // 1.2 Log maintenance start for violation counting
                await db.query(
                    "INSERT INTO operation_logs (action_type, operator_id, operator_name, target_id, details) VALUES ($1, $2, $3, $4, $5)",
                    ['MAINTENANCE_START', 'SYSTEM', 'Bot System', 'SYSTEM', '異常検知による自動メンテナンス開始']
                );

                // 1.5 SMART AUTO-BLOCK: Automatically blacklist culprits
                for (const culprit of culprits) {
                    const reason = `[AUTO-BLOCK] 異常なアクティベート回数検知 (${culprit.activation_count}件/時)`;
                    
                    // Blacklist by User ID (if available)
                    if (culprit.operator_id && culprit.operator_id !== 'Unknown') {
                        await db.query(
                            'INSERT INTO blacklist (target_id, type, reason, operator_id) VALUES ($1, $2, $3, $4) ON CONFLICT (target_id) DO UPDATE SET reason = EXCLUDED.reason',
                            [culprit.operator_id, 'user', reason, 'SYSTEM']
                        );
                    }
                    
                    // Blacklist by IP Address (if available)
                    if (culprit.ip_address && culprit.ip_address !== 'Unknown') {
                        await db.query(
                            'INSERT INTO blacklist (target_id, type, reason, operator_id) VALUES ($1, $2, $3, $4) ON CONFLICT (target_id) DO UPDATE SET reason = EXCLUDED.reason',
                            [culprit.ip_address, 'ip', reason, 'SYSTEM']
                        );
                    }
                }

                // 2. Notify Admins
                const adminIds = (process.env.ADMIN_DISCORD_IDS || '').split(',').map(id => id.trim()).filter(id => id);
                
                const culpritDetails = culprits.map(c => 
                    `- **User:** ${c.operator_name || 'Unknown'} (\`${c.operator_id || 'N/A'}\`)\n  **IP:** \`${c.ip_address || 'Unknown'}\`\n  **Count:** ${c.activation_count}件`
                ).join('\n\n');

                const alertEmbed = new EmbedBuilder()
                    .setTitle('🚨 【緊急】システム自動ロック (個別検知)')
                    .setDescription(`短時間に同一ユーザー/IPから過剰なアクティベートが検知されたため、システムを自動ロックしました。`)
                    .addFields(
                        { name: '検知対象', value: culpritDetails.length > 1024 ? culpritDetails.substring(0, 1021) + '...' : culpritDetails },
                        { name: '判定しきい値', value: `${THRESHOLD} 件 / 1時間`, inline: true }
                    )
                    .setColor(0xff0000)
                    .setTimestamp();

                for (const adminId of adminIds) {
                    const adminUser = await client.users.fetch(adminId).catch(() => null);
                    if (adminUser) await adminUser.send({ embeds: [alertEmbed] }).catch(() => null);
                }

                // 3. Post Public Announcement (if configured)
                const announceChannelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
                if (announceChannelId) {
                    const channel = await client.channels.fetch(announceChannelId).catch(() => null);
                    if (channel) {
                        const announceEmbed = new EmbedBuilder()
                            .setTitle('🚧 緊急メンテナンスのお知らせ')
                            .setDescription('システムで異常なアクティビティが検知されたため、現在緊急メンテナンスを実施しております。\n復旧までしばらくお待ちくださいますようお願い申し上げます。')
                            .setColor(0xffff00) // Yellow
                            .setTimestamp();
                        await channel.send({ embeds: [announceEmbed] }).catch(err => console.error('[Cron] Failed to send public announcement:', err.message));
                    }
                }
            }
        } catch (err) { console.error('[Cron] Anomaly Detection Error:', err); }
    });

    // 8. Auto-Recovery Check: Every 10 minutes (*/10 * * * *)
    cron.schedule('*/10 * * * *', async () => {
        try {
            const maintRes = await db.query("SELECT value FROM bot_system_settings WHERE key = 'maintenance_mode'");
            const isMaint = maintRes.rows.length > 0 ? maintRes.rows[0].value === 'true' : false;

            if (isMaint) {
                const anomalyRes = await db.query("SELECT value FROM bot_system_settings WHERE key = 'last_anomaly_at'");
                if (anomalyRes.rows.length > 0 && anomalyRes.rows[0].value) {
                    const lastAnomaly = new Date(anomalyRes.rows[0].value);
                    const now = new Date();
                    const recoveryThreshold = 60 * 60 * 1000; // 1 hour

                    if (now - lastAnomaly >= recoveryThreshold) {
                        console.log('[Cron] Auto-recovery triggered: 1 hour passed since last anomaly.');

                        // 1. Deactivate Maintenance Mode
                        await db.query("UPDATE bot_system_settings SET value = 'false' WHERE key = 'maintenance_mode'");
                        
                        // 2. Post Recovery Announcement
                        const announceChannelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
                        if (announceChannelId) {
                            const channel = await client.channels.fetch(announceChannelId).catch(() => null);
                            if (channel) {
                                const recoveryEmbed = new EmbedBuilder()
                                    .setTitle('✅ メンテナンス終了のお知らせ')
                                    .setDescription('システムの安全が確認されたため、緊急メンテナンスを終了し、通常稼働を再開いたしました。\nご不便をおかけいたしました。')
                                    .setColor(0x00ff00) // Green
                                    .setTimestamp();
                                await channel.send({ embeds: [recoveryEmbed] }).catch(() => null);
                            }
                        }

                        // 3. Notify Admins about the recovery
                        const adminIds = (process.env.ADMIN_DISCORD_IDS || '').split(',').map(id => id.trim()).filter(id => id);
                        const recoveryInfoEmbed = new EmbedBuilder()
                            .setTitle('🛡️ システム自動復旧完了')
                            .setDescription('1時間以上異常や違反が検知されなかったため、メンテナンスモードを自動的に解除しました。')
                            .setColor(0x00ff00)
                            .setTimestamp();
                        
                        for (const adminId of adminIds) {
                            const adminUser = await client.users.fetch(adminId).catch(() => null);
                            if (adminUser) await adminUser.send({ embeds: [recoveryInfoEmbed] }).catch(() => null);
                        }
                    }
                }
            }
        } catch (err) { console.error('[Cron] Auto-recovery Check Error:', err); }
    });
}

module.exports = { startCron };
