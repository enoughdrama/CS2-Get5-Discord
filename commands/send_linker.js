const { SlashCommandBuilder } = require('discord.js');
const { getSteamLink } = require('../utils/steamLinker');

module.exports = {
    name: 'send_linker',
    data: new SlashCommandBuilder()
        .setName('send_linker')
        .setDescription('Привяжите или проверьте свой SteamID.'),
    async execute(interaction, client) {
        const userId = interaction.user.id;
        const steamId = await getSteamLink(userId);
        const description = steamId
            ? `Ваш SteamID: **${steamId}**\nВы можете перепривязать или отвязать стим.`
            : 'Введите свой SteamID для привязки стим-аккаунта.';

        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const embed = new EmbedBuilder()
            .setTitle('Привязка Steam')
            .setDescription(description)
            .setColor('Green');

        const linkLabel = '🎓  Привязать стим';
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('steam_link')
                .setLabel(linkLabel)
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('steam_unlink')
                .setLabel('❌  Отвязать стим')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('steam_check')
                .setLabel('🔎  Проверка')
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
    },
};
