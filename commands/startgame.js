const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { createNewGame } = require('../utils/gameManager');

module.exports = {
  name: 'startgame',
  data: new SlashCommandBuilder()
    .setName('startgame')
    .setDescription('Создать новый матч с указанным количеством игроков (admin only).')
    .addIntegerOption(option =>
      option
        .setName('players')
        .setDescription('Количество игроков, необходимых для матча')
        .setRequired(true)
    ),
  async execute(interaction, client) {
    // Проверка: команда только для администраторов
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: 'У вас нет прав для использования этой команды.',
        ephemeral: true,
      });
    }

    // Deferred ответ для информирования пользователя о процессе обработки запроса
    await interaction.deferReply({ ephemeral: true });

    const requiredPlayers = interaction.options.getInteger('players');
    const guild = interaction.guild;

    // Создаём новую категорию для данного матча
    const category = await guild.channels.create({
      name: `Match ${Date.now()}`,
      type: ChannelType.GuildCategory,
    });

    // Создаём голосовой канал "Lobby" внутри созданной категории
    const lobbyVoice = await guild.channels.create({
      name: 'Lobby',
      type: ChannelType.GuildVoice,
      parent: category.id,
    });

    // Создаём текстовый канал "queue" в той же категории
    const queueTextChannel = await guild.channels.create({
      name: 'queue',
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        {
          id: guild.roles.everyone,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
      ],
    });

    // Создаём новый матч; embed с информацией о матче публикуется в канале queue
    const gameData = await createNewGame({
      guild,
      queueTextChannel,
      lobbyVoice,
      requiredPlayers,
    });

    // Редактируем ответ, сообщая конечный результат
    await interaction.editReply({
      content:
        `Матч #${gameData.gameId} создан!\n` +
        `Необходимо игроков: **${requiredPlayers}**.\n` +
        `Голосовой канал: **${lobbyVoice.name}**.\n` +
        `Информация о матче в канале: <#${queueTextChannel.id}>.\n\n` +
        `Пожалуйста, ожидайте дальнейшей обработки...`,
    });
  },
};
