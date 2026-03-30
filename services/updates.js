/**
 * Extracts ALL new release notes from UPDATE_LOG.md since last announced version,
 * ordered from oldest to newest new version.
 * @param {string} lastVersion 
 * @returns {{ notes: string, latestVersion: string }}
 */
function getNewReleaseNotes(lastVersion) {
    try {
        const possiblePaths = [
            path.join(__dirname, '../../Bot/UPDATE_LOG.md'),
            path.join(__dirname, '../Bot/UPDATE_LOG.md'),
            path.join(__dirname, '../UPDATE_LOG_SYNC.md'),
        ];

        let logPath = null;
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) { logPath = p; break; }
        }

        if (!logPath) return { notes: '', latestVersion: null };

        const content = fs.readFileSync(logPath, 'utf8');
        // Split content by version markers "## vX.X.X"
        // Using a regex to split but keep the markers
        const sections = content.split(/(?=## v\d+\.\d+\.\d+)/);
        
        let newSections = [];
        let latestVersion = null;

        // The first section might be the title/header, ignore if it doesn't have a version
        for (const section of sections) {
            const versionMatch = section.match(/^## v(\d+\.\d+\.\d+)/);
            if (!versionMatch) continue;

            const currentVer = versionMatch[1];
            if (!latestVersion) latestVersion = currentVer; // First encountered version is the latest in markdown

            // If we hit the last announced version, stop searching
            if (lastVersion && currentVer === lastVersion) {
                break;
            }

            // This is a new section
            newSections.push(section.trim());
        }

        // If we found new sections, reverse them so they are ordered by OLD -> NEW
        // (Since the MD usually has NEW at the top)
        const reversedNotes = newSections.reverse().join('\n\n---\n\n').trim();

        return { 
            notes: reversedNotes, 
            latestVersion 
        };
    } catch (err) {
        console.error('[Updates] Failed to read update log delta:', err.message);
        return { notes: '', latestVersion: null };
    }
}

/**
 * Scheduled task to announce new updates on Fridays
 * @param {import('discord.js').Client} client 
 */
async function announceWeeklyUpdates(client) {
    try {
        console.log('[Updates] Running scheduled weekly update check...');

        const settingsRes = await db.query("SELECT value FROM bot_system_settings WHERE key = 'last_announced_version'");
        const lastVersion = settingsRes.rows.length > 0 ? settingsRes.rows[0].value : null;

        const { notes, latestVersion } = getNewReleaseNotes(lastVersion);

        if (!notes || !latestVersion || latestVersion === lastVersion) {
            console.log('[Updates] No new update content to announce this week.');
            return;
        }

        const channelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
        if (!channelId) return;

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) {
            // Split if message is too long for Discord (4096 chars for embed description)
            const description = `今週追加・更新された内容をお知らせいたします！\n\n${notes}\n\n今後ともAkatsukiBotをよろしくお願いいたします。`;
            const finalDesc = description.length > 4000 ? description.substring(0, 3990) + '...' : description;

            const embed = new EmbedBuilder()
                .setAuthor({
                    name: 'AkatsukiBot Update System',
                    iconURL: 'https://cdn.discordapp.com/emojis/1150654483737526312.png'
                })
                .setTitle(`🚀 【定期】AkatsukiBot アップデート情報通知`)
                .setDescription(finalDesc)
                .setColor(0x7aa2f7)
                .setTimestamp()
                .setFooter({
                    text: `AkatsukiBot | Latest: v${latestVersion}`,
                    iconURL: client.user.displayAvatarURL()
                });

            await channel.send({ embeds: [embed] });
            console.log(`[Updates] Successfully announced update delta up to v${latestVersion}`);

            // Update last announced version to the latest one found
            await db.query(
                "INSERT INTO bot_system_settings (key, value, updated_at) VALUES ('last_announced_version', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
                [latestVersion]
            );
        }
    } catch (err) {
        console.error('[Updates] Error in weekly announcement:', err.message);
    }
}

module.exports = { announceWeeklyUpdates };
