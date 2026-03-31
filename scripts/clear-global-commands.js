const { REST, Routes } = require('discord.js');
require('dotenv').config();

async function main() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('[Cleanup] Clearing all GLOBAL application (/) commands...');
        const clientId = process.env.CLIENT_ID || (await rest.get(Routes.user('@me'))).id;

        // Registering an empty array to global commands deletes all of them
        await rest.put(Routes.applicationCommands(clientId), { body: [] });

        console.log('[Cleanup] Successfully cleared GLOBAL commands.');
    } catch (error) {
        console.error('[Cleanup] Error:', error);
        process.exit(1);
    }
}

main();
