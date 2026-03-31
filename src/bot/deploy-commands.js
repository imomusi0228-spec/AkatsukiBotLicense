// filename: src/bot/deploy-commands.js
const { REST, Routes } = require('discord.js');
const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = require('../config/env');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
    }
}

(async () => {
    try {
        const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

        // 1. グローバルコマンドのリセット (重複解消のため)
        logger.info('[Bot] Clearing GLOBAL application (/) commands...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });

        // 2. ギルドコマンドの登録
        logger.info(`[Bot] Started refreshing ${commands.length} GUILD application (/) commands for ${GUILD_ID}.`);

        const data = await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands },
        );

        logger.info(`[Bot] Successfully reloaded ${data.length} GUILD commands.`);
    } catch (error) {
        logger.error('[Bot] Error deploying commands:', error);
    }
})();
