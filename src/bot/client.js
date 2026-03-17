// filename: src/bot/client.js
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = require('../config/env');
const logger = require('../utils/logger');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers
    ]
});

client.commands = new Collection();

/**
 * コマンドファイルの読み込み
 */
const loadCommands = () => {
    const commandsPath = path.join(__dirname, 'commands');
    if (!fs.existsSync(commandsPath)) return;
    
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            logger.warn(`[Bot] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
    logger.info(`[Bot] Loaded ${client.commands.size} commands.`);
};

// インタラクション処理
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        logger.error('[Bot] Error executing command:', error);
        const reply = { content: 'コマンドの実行中にエラーが発生しました。', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply).catch(() => {});
        } else {
            await interaction.reply(reply).catch(() => {});
        }
    }
});

client.once('ready', () => {
    logger.info(`[Bot] Logged in as ${client.user.tag}`);
});

module.exports = {
    client,
    loadCommands
};
