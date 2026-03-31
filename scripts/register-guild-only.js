const { REST, Routes } = require('discord.js');
const { adminCommands, publicCommands } = require('../commands');
require('dotenv').config();

async function main() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('[Register] Registering Guild Commands ONLY...');
        const clientId = process.env.CLIENT_ID || (await rest.get(Routes.user('@me'))).id;
        const guildId = process.env.SUPPORT_GUILD_ID;

        if (!guildId) {
            console.error('SUPPORT_GUILD_ID is not defined in .env');
            process.exit(1);
        }

        const allCommandsJson = [
            ...publicCommands.map(cmd => cmd.toJSON()),
            ...adminCommands.map(cmd => cmd.toJSON())
        ];

        console.log(`[Register] Target Guild: ${guildId}`);
        console.log(`[Register] Commands: ${allCommandsJson.map(c => c.name).join(', ')}`);

        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: allCommandsJson });

        console.log('[Register] Successfully registered Guild commands.');
    } catch (error) {
        console.error('[Register] Error:', error);
        process.exit(1);
    }
}

main();
