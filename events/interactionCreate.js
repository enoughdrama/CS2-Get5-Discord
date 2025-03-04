const { 
  SlashCommandBuilder,
  InteractionType 
} = require('discord.js');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    // Обработка модальных окон (например, для ввода SteamID)
    if (interaction.type === InteractionType.ModalSubmit) {
      // Если модальное окно для стим привязки
      if (interaction.customId === 'steam_modal') {
        // Модальное окно обрабатывается в events/modalSubmit.js
        const modalHandler = require('./modalSubmit');
        return modalHandler.execute(interaction, client);
      }
      // Если есть иные модальные окна, их можно добавить здесь
      return;
    }
    
    // Обработка slash-команд
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;
      const command = client.commands.get(commandName);
      if (!command) {
        return interaction.reply({ content: 'Неизвестная команда!', ephemeral: true });
      }
      try {
        await command.execute(interaction, client);
      } catch (error) {
        console.error(`Ошибка в команде ${commandName}:`, error);
        if (!interaction.replied) {
          await interaction.reply({ content: 'Ошибка при выполнении команды!', ephemeral: true });
        }
      }
      return;
    }
    
    // Обработка кнопок
    if (interaction.isButton()) {
      // Если кнопка для стим-связи (начинается с "steam_")
      if (interaction.customId.startsWith('steam_')) {
        const steamAction = interaction.customId.split('_')[1]; // "link", "unlink", "check"
        if (steamAction === 'link') {
          // Показываем модальное окно для ввода SteamID
          const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
          const modal = new ModalBuilder()
            .setCustomId('steam_modal')
            .setTitle('Привязка Steam');
          const steamInput = new TextInputBuilder()
            .setCustomId('steam_id')
            .setLabel('Введите ваш SteamID')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
          const firstActionRow = new ActionRowBuilder().addComponents(steamInput);
          modal.addComponents(firstActionRow);
          return interaction.showModal(modal);
        } else if (steamAction === 'unlink') {
          const { removeSteamLink } = require('../utils/steamLinker');
          await removeSteamLink(interaction.user.id);
          const roleId = process.env.STEAM_ROLE_ID;
          if (roleId) {
            try {
              await interaction.member.roles.remove(roleId);
            } catch (error) {
              console.error('Ошибка снятия роли стим:', error);
            }
          }
          return interaction.reply({ content: 'Ваш SteamID отвязан.', ephemeral: true });
        } else if (steamAction === 'check') {
          const { getSteamLink } = require('../utils/steamLinker');
          const linkedSteam = await getSteamLink(interaction.user.id);
          return interaction.reply({ content: linkedSteam ? `Ваш SteamID: **${linkedSteam}**` : 'Вы не привязаны к Steam.', ephemeral: true });
        } else {
          return interaction.reply({ content: 'Неизвестное действие для Steam.', ephemeral: true });
        }
      }
      
      // Если кнопка для игровых этапов (ready, veto, pick)
      const parts = interaction.customId.split('_');
      const action = parts[0];
      const gameId = parts[1];
      const payload = parts.length > 2 ? parts.slice(2).join('_') : null;
      const { handleReadyCheck, handleVetoInteraction, handlePickInteraction } = require('../utils/gameManager');
      try {
        if (action === 'ready') {
          await handleReadyCheck(interaction, gameId);
        } else if (action === 'veto') {
          await handleVetoInteraction(interaction, gameId, payload);
        } else if (action === 'pick') {
          await handlePickInteraction(interaction, gameId, payload);
        } else {
          await interaction.reply({ content: 'Неизвестное действие кнопки.', ephemeral: true });
        }
      } catch (error) {
        console.error('Ошибка при обработке кнопки:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Произошла ошибка при обработке!', ephemeral: true });
        } else {
          await interaction.followUp({ content: 'Ошибка при обработке.', ephemeral: true });
        }
      }
    }
  }
};