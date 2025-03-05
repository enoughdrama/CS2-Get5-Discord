module.exports = {
    name: 'modalSubmit',
    async execute(interaction, client) {
        if (interaction.customId !== 'steam_modal') return;

        const steamId = interaction.fields.getTextInputValue('steam_id').trim();
        // Простая проверка: не пустое и состоит только из цифр (SteamID64)
        if (!steamId || !/^\d+$/.test(steamId)) {
            return interaction.reply({ content: 'Введён некорректный SteamID. Попробуйте ещё раз.', ephemeral: true });
        }

        const { setSteamLink } = require('../utils/steamLinker');
        await setSteamLink(interaction.user.id, steamId);

        const roleId = process.env.STEAM_ROLE_ID;
        if (roleId) {
            try {
                await interaction.member.roles.add(roleId);
            } catch (error) {
                console.error('Ошибка выдачи роли стим:', error);
            }
        }

        await interaction.reply({ content: `Ваш SteamID **${steamId}** успешно привязан!`, ephemeral: true });
    },
};
