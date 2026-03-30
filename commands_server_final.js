const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('./db');

const publicCommands = [
    new SlashCommandBuilder()
        .setName('activate')
        .setDescription('BOOTHの注文番号を使ってライセンスを有効化します')
        .addStringOption(option => 
            option.setName('order_number')
                .setDescription('BOOTHの注文番号（数字のみ）を入力してください')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('token')
                .setDescription('DMで届いた「トークン」を入力してください')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('buyer_name')
                .setDescription('トークンがない場合は、購入者名を入力してください')
                .setRequired(false)),
    new SlashCommandBuilder()
        .setName('portal')
        .setDescription('購入者向けセルフポータルのリンクを表示します'),
    new SlashCommandBuilder()
        .setName('sync')
        .setDescription('あなたのステータスを同期します（管理者の場合は全体同期）'),
    new SlashCommandBuilder()
        .setName('move')
        .setDescription('現在のサーバーのライセンスを解除し、別のサーバーへ移動する準備をします')
];

const commands = [...publicCommands];

async function logCommandUsage(interaction) {
    if (!interaction.isChatInputCommand()) return;
    try {
        await db.query(
            'INSERT INTO command_usage_logs (command_name, guild_id, user_id) VALUES ($1, $2, $3)',
            [interaction.commandName, interaction.guildId, interaction.user.id]
        );
    } catch (e) {
        console.error('[Analytics] Failed to log command usage:', e.message);
    }
}

async function handleInteraction(interaction) {
    // 1. Blacklist check
    try {
        const blCheck = await db.query(
            'SELECT 1 FROM blacklist WHERE target_id = $1 OR target_id = $2',
            [interaction.user.id, interaction.guildId]
        );
        if (blCheck.rows.length > 0) {
            const msg = '❌ あなた、またはこのサーバーはブラックリストに登録されているため、ボットの機能を利用できません。';
            return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }
    } catch (e) {
        console.error('Blacklist check error:', e);
    }

    if (!interaction.isChatInputCommand()) return;

    if (['activate', 'portal', 'sync', 'move'].includes(interaction.commandName)) {
        try {
            await logCommandUsage(interaction);
            const commandHandler = require(`./subcommands/${interaction.commandName}`);
            await commandHandler(interaction);
        } catch (error) {
            console.error(`Error executing command ${interaction.commandName}:`, error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'エラーが発生しました。', flags: MessageFlags.Ephemeral });
            } else {
                await interaction.editReply({ content: 'エラーが発生しました。' });
            }
        }
    } else {
        await interaction.reply({ content: 'このコマンドは現在利用できないか、削除されました。', flags: MessageFlags.Ephemeral });
    }
}

module.exports = { commands, handleInteraction };
