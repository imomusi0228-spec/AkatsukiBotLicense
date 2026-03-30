const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();
const db = require('../src/config/env').DATABASE_URL;
const { Pool } = require('pg');
const pool = new Pool({ connectionString: db });

const { 
    DISCORD_TOKEN, 
    GUILD_ID,
    ROLE_PRO_MONTHLY,
    ROLE_PRO_PLUS_MONTHLY,
    ROLE_TRIAL_PRO,
    ROLE_TRIAL_PRO_PLUS
} = require('../src/config/env');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

async function migrate() {
    try {
        console.log('Connecting to Discord...');
        await client.login(DISCORD_TOKEN);
        const guild = await client.guilds.fetch(GUILD_ID);
        if (!guild) throw new Error('Guild not found');

        console.log('Fetching Trial subscriptions from DB...');
        const res = await pool.query(`
            SELECT user_id, tier 
            FROM subscriptions 
            WHERE is_active = TRUE 
              AND (tier = 'Trial Pro' OR tier = 'Trial Pro+')
        `);

        console.log(`Found ${res.rows.length} active Trial subscriptions.`);

        for (const row of res.rows) {
            try {
                const member = await guild.members.fetch(row.user_id).catch(() => null);
                if (!member) {
                    console.log(`[Skip] User ${row.user_id} not in guild.`);
                    continue;
                }

                const isPlus = row.tier === 'Trial Pro+';
                const oldRoleId = isPlus ? ROLE_PRO_PLUS_MONTHLY : ROLE_PRO_MONTHLY;
                const newRoleId = isPlus ? ROLE_TRIAL_PRO_PLUS : ROLE_TRIAL_PRO;

                console.log(`Processing ${member.user.tag} (${row.tier})...`);

                // Remove old role if present
                if (member.roles.cache.has(oldRoleId)) {
                    await member.roles.remove(oldRoleId, 'Migrating to Trial specific role');
                    console.log(`  - Removed legacy role: ${oldRoleId}`);
                }

                // Add new role if not present
                if (!member.roles.cache.has(newRoleId)) {
                    await member.roles.add(newRoleId, 'Migrating to Trial specific role');
                    console.log(`  + Added new Trial role: ${newRoleId}`);
                }
            } catch (err) {
                console.error(`Failed to process user ${row.discord_id}:`, err.message);
            }
        }

        console.log('Migration completed.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await pool.end();
        client.destroy();
    }
}

migrate();
