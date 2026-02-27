require('dotenv').config(); // Load env vars FIRST
const { Client, GatewayIntentBits, Events, ActivityType } = require('discord.js');

// Enviroment Variable Check
const envVars = ['DATABASE_URL', 'DISCORD_TOKEN', 'CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'ADMIN_TOKEN', 'PUBLIC_URL', 'ANNOUNCEMENT_CHANNEL_ID'];
envVars.forEach(key => {
    if (!process.env[key]) console.warn(`[Config] ${key} is missing!`);
});
const db = require('./db');
const { handleInteraction } = require('./commands');
const { syncSubscriptions } = require('./sync');
const { startServer } = require('./server');
const { startCron } = require('./services/cron');

console.log('==========================================');
console.log('   Akatsuki Bot System - Starting Up...');
console.log('==========================================');

// 1. Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Presence Helper
const setBotPresence = () => {
    if (client.user) {
        client.user.setPresence({
            activities: [{ name: '/help | 管理ツール', type: ActivityType.Playing }],
            status: 'online'
        });
    }
};

client.once(Events.ClientReady, async () => {
    console.log(`[Discord] Ready! Logged in as ${client.user.tag}`);
    setBotPresence();

    const runBackgroundTasks = async () => {
        try {
            await syncSubscriptions(client);
        } catch (err) {
            console.error('[Background] Tasks failed:', err.message);
        }
    };

    runBackgroundTasks();
    startCron(client); // Start Cron Scheduler

    // Check for updates/announcements after a short delay to avoid startup rate limit
    setTimeout(async () => {
        try {
            const { checkForUpdates } = require('./services/updates');
            await checkForUpdates(client);

            const syncOnBoot = require('./scripts/sync_on_boot');
            await syncOnBoot(client).catch(err => console.error('[SyncOnBoot] Background sync failed:', err));
        } catch (err) {
            console.error('[Startup] Failed to run update/sync tasks:', err);
        }
    }, 5000); // 5 second delay

    setInterval(runBackgroundTasks, 3600000); // Sync roles every hour
});

client.on('interactionCreate', handleInteraction);

client.on('messageCreate', async (message) => {
    const { handleApplicationMessage } = require('./handlers/applicationHandler');
    await handleApplicationMessage(message, client);
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    // If partial, we might need to fetch the full message (though usually content is available)
    if (newMessage.partial) {
        try {
            await newMessage.fetch();
        } catch (err) {
            console.error('[Discord] Failed to fetch updated message:', err);
            return;
        }
    }
    const { handleApplicationMessage } = require('./handlers/applicationHandler');
    await handleApplicationMessage(newMessage, client);
});

client.on('error', error => console.error('[Discord] Client Error:', error));
client.on('shardReady', (id) => {
    console.log(`[Discord] Shard ${id} is ready.`);
    setBotPresence();
});

// Auto Role sync on Member Join
client.on(Events.GuildMemberAdd, async (member) => {
    if (member.guild.id !== process.env.SUPPORT_GUILD_ID) return;
    try {
        const initialRoleId = process.env.ROLE_USER_ID;
        if (initialRoleId) await member.roles.add(initialRoleId).catch(() => null);

        const res = await db.query('SELECT tier FROM subscriptions WHERE user_id = $1 AND is_active = TRUE', [member.id]);
        if (res.rows.length > 0) {
            let tier = 'Pro';
            if (res.rows.some(r => r.tier === 'Pro+')) tier = 'Pro+';
            const { updateMemberRoles } = require('./sync');
            await updateMemberRoles(member.guild, member.id, tier);
        }
    } catch (err) {
        console.error('[Discord] Error in auto-role assignment:', err);
    }
});

async function main() {
    try {
        console.log('[Main] Starting web server...');
        startServer(client);

        console.log('[Main] Initializing database...');
        await db.initDB();

        if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN is missing!');

        console.log('[Main] Logging into Discord...');
        await client.login(process.env.DISCORD_TOKEN.trim());

        console.log('[Main] System startup sequence completed.');
    } catch (error) {
        console.error('==========================================');
        console.error('   FATAL STARTUP ERROR');
        console.error('==========================================');
        console.error(`Error Name: ${error.name}`);
        console.error(`Error Message: ${error.message}`);
        if (error.stack) {
            console.error('Stack Trace:');
            console.error(error.stack);
        }
        console.error('==========================================');
        process.exit(1);
    }
}

main();
