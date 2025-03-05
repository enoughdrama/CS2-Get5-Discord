// ФАЙЛ: commands/endgame.js
const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const Match = require('../models/match');
const { activeGames } = require('../utils/gameManager');

module.exports = {
  name: 'endgame',
  data: new SlashCommandBuilder()
    .setName('endgame')
    .setDescription('Завершить игру и удалить данные из БД (admin only).')
    .addStringOption(option =>
      option
        .setName('gameid')
        .setDescription('Идентификатор матча, который нужно завершить')
        .setRequired(true)
    ),
  async execute(interaction, client) {
    // Проверка прав администратора
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'У вас нет прав для использования этой команды.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const gameId = interaction.options.getString('gameid');
    const guild = interaction.guild;

    // Ищем игру в activeGames
    let gameData = activeGames.get(gameId);
    // Также пытаемся найти игру в MongoDB
    const gameDataDB = await Match.findOne({ gameId });
    if (!gameData && !gameDataDB) {
      return interaction.editReply({ content: `Игра с gameId ${gameId} не найдена ни в памяти, ни в базе.` });
    }
    // Если игра не найдена в памяти, используем данные из БД для удаления каналов
    if (!gameData) {
      gameData = {
        gameId: gameDataDB.gameId,
        guildId: gameDataDB.guildId,
        lobbyId: gameDataDB.lobbyId,
        queueChannelId: gameDataDB.queueChannelId,
        team1ChannelId: gameDataDB.team1ChannelId,
        team2ChannelId: gameDataDB.team2ChannelId
      };
    }

    // Удаляем каналы команд, если они существуют
    try {
      if (gameData.team1ChannelId) {
        const team1Channel = await guild.channels.fetch(gameData.team1ChannelId);
        if (team1Channel) {
          await team1Channel.delete();
        }
      }
      if (gameData.team2ChannelId) {
        const team2Channel = await guild.channels.fetch(gameData.team2ChannelId);
        if (team2Channel) {
          await team2Channel.delete();
        }
      }
    } catch (error) {
      console.error(`Ошибка при удалении голосовых каналов матча ${gameId}:`, error);
    }

    // Удаляем запись матча из БД
    try {
      await Match.findOneAndDelete({ gameId });
    } catch (error) {
      console.error(`Не удалось удалить матч (gameId=${gameId}) из БД:`, error);
      return interaction.editReply({ content: 'Ошибка удаления матча из базы данных.' });
    }

    // Удаляем игру из активных игр
    activeGames.delete(gameId);

    await interaction.editReply({ content: `Матч с gameId ${gameId} успешно завершён и удалён из БД. Каналы команд также удалены.` });
  },
};
