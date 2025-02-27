const { finalizeTeams, activeGames } = require('../utils/gameManager');
const { PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'endgame',
  description: 'Принудительно завершить матч по указанному match_id (admin only).',
  async execute(interaction, client) {
    // Команда доступна только администраторам
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'У вас нет прав для использования этой команды.', ephemeral: true });
    }

    const matchId = interaction.options.getString('match_id');
    if (!matchId) {
      return interaction.reply({ content: 'Необходимо указать match_id.', ephemeral: true });
    }

    const gameData = activeGames.get(matchId);
    if (!gameData) {
      return interaction.reply({ content: `Матч с ID ${matchId} не найден или уже завершен.`, ephemeral: true });
    }

    try {
      // finalizeTeams удаляет голосовые каналы команд, если они созданы, и сохраняет матч в БД.
      await finalizeTeams(gameData, client);
      await interaction.reply({ content: `Матч #${matchId} завершен. Командные голосовые каналы удалены (если присутствуют).`, ephemeral: true });
    } catch (err) {
      console.error('Ошибка при завершении матча:', err);
      await interaction.reply({ content: 'Ошибка при завершении матча.', ephemeral: true });
    }
  },
};
