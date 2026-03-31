const { REST, Routes } = require('discord.js');
const { adminCommands, publicCommands } = require('../commands');
require('dotenv').config();

const commands = [...publicCommands, ...adminCommands];

async function main() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('[Register] Started refreshing application (/) commands.');

        const clientId = process.env.CLIENT_ID || (await rest.get(Routes.user('@me'))).id;

        // 1. Clear Global Commands (to avoid duplicates with Guild commands)
        console.log('[Register] Cleaning up GLOBAL commands...');
        await rest.put(Routes.applicationCommands(clientId), { body: [] });

        // 2. Guild Commands (Instant update for Support server)
        // Note: Guild commands update instantly but only for the specific guild.
        if (process.env.SUPPORT_GUILD_ID) {
            console.log(`[Register] Registering ${publicJson.length + adminCommands.length} guild commands to ${process.env.SUPPORT_GUILD_ID}...`);
            const allCommandsJson = [...publicJson, ...adminCommands.map(cmd => cmd.toJSON())];
            await rest.put(Routes.applicationGuildCommands(clientId, process.env.SUPPORT_GUILD_ID), { body: allCommandsJson });
        }

        console.log('[Register] Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('[Register] Error:', error);
        process.exit(1);
    }
}

main();
