const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const adminCommands = [
    new SlashCommandBuilder()
        .setName('sync')
        .setDescription('サブスクリプションとロールを最新の状態に同期します'),
    new SlashCommandBuilder()
        .setName('apply')
        .setDescription('ライセンス申請パネルを設置します')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('move')
        .setDescription('現在のサーバーのライセンスを解除し、別のサーバーへ移動する準備をします')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

const publicCommands = [
    new SlashCommandBuilder()
        .setName('activate')
        .setDescription('サーバーのサブスクリプションを有効化します')
        .addStringOption(option =>
            option.setName('guild_id').setDescription('サーバーID (サーバー内で使用する場合は省略可)').setRequired(false))
        .addStringOption(option =>
            option.setName('key').setDescription('ライセンスキーまたはBooth注文番号').setRequired(false)),
    new SlashCommandBuilder()
        .setName('portal')
        .setDescription('購入者向けセルフポータルのリンクを表示します'),
    new SlashCommandBuilder()
        .setName('sync')
        .setDescription('あなたのステータスを同期します（管理者の場合は全体同期）')
];

const commands = [...adminCommands, ...publicCommands];
const db = require('./db');

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
    // 1. Blacklist check for ALL interaction types (User and Guild)
    try {
        const blCheck = await require('./db').query(
            'SELECT 1 FROM blacklist WHERE target_id = $1 OR target_id = $2',
            [interaction.user.id, interaction.guildId]
        );
        if (blCheck.rows.length > 0) {
            const msg = '❌ あなた、またはこのサーバーはブラックリストに登録されているため、ボットの機能を利用できません。';
            if (interaction.replied || interaction.deferred) {
                return interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
            }
            return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }
    } catch (e) {
        console.error('Blacklist check error:', e);
    }

    if (interaction.isButton()) {
        return;
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'select_tier') {
            const selectedTier = interaction.values[0];
            if (selectedTier === 'none') return;
            const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

            const modal = new ModalBuilder()
                .setCustomId(`application_modal:${selectedTier}`)
                .setTitle(`ライセンス申請 (${selectedTier})`);

            const boothInput = new TextInputBuilder()
                .setCustomId('booth_name')
                .setLabel('購入者名 (BOOTH)')
                .setPlaceholder('例: 山田 太郎')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const boothOrderInput = new TextInputBuilder()
                .setCustomId('booth_order_id')
                .setLabel('BOOTH注文番号 (任意・入力で自動照合)')
                .setPlaceholder('例: 12345678')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            const userInput = new TextInputBuilder()
                .setCustomId('user_id')
                .setLabel('有効化するユーザーID')
                .setValue(interaction.user.id)
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const isSupportGuild = interaction.guildId === process.env.SUPPORT_GUILD_ID;

            const guildInput = new TextInputBuilder()
                .setCustomId('guild_id')
                .setLabel('有効化するサーバーID')
                .setPlaceholder('例: 123456789012345678')
                .setValue(!isSupportGuild && interaction.guildId ? interaction.guildId : '')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(boothInput),
                new ActionRowBuilder().addComponents(boothOrderInput),
                new ActionRowBuilder().addComponents(userInput),
                new ActionRowBuilder().addComponents(guildInput)
            );

            await interaction.showModal(modal);
        }
        return;
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('application_modal')) {
            const { handleApplicationModal } = require('./handlers/applicationHandler');
            await handleApplicationModal(interaction);
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    // Admin commands authorization check
    const adminActionCommands = ['apply', 'move', 'setup_vc']; // list explicitly
    const isAdminCommand = adminActionCommands.includes(interaction.commandName);
    if (isAdminCommand) {
        const allowedIds = (process.env.ADMIN_DISCORD_IDS || '').split(',').map(id => id.trim());
        const isExplicitAdmin = allowedIds.includes(interaction.user.id);
        const hasDiscordAdmin = interaction.member && interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!isExplicitAdmin && !hasDiscordAdmin) {
            return interaction.reply({ content: '❌ このコマンドを実行する権限がありません。', flags: MessageFlags.Ephemeral });
        }
    }

    if (['sync', 'activate', 'apply', 'move', 'portal'].includes(interaction.commandName)) {
        try {
            await logCommandUsage(interaction);
            const commandHandler = require(`./subcommands/${interaction.commandName}`);
            await commandHandler(interaction);
        } catch (error) {
            console.error(`Error executing command ${interaction.commandName}:`, error);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'エラーが発生しました。', flags: MessageFlags.Ephemeral });
                } else if (interaction.deferred) {
                    await interaction.editReply({ content: 'エラーが発生しました。' });
                } else {
                    await interaction.followUp({ content: 'エラーが発生しました。', flags: MessageFlags.Ephemeral });
                }
            } catch (replyError) {
                console.error('Failed to send error message to user:', replyError);
            }
        }
    } else {
        try {
            await interaction.reply({ content: 'このコマンドは現在利用できないか、削除されました。', flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('Failed to reply to unknown command:', e);
        }
    }
}

module.exports = { commands, adminCommands, publicCommands, handleInteraction };
