const { Rcon } = require('rcon-client');
const User = require('../models/user');

const servers = [
    {
        host: '',
        port: 27015,
        rconPassword: ''
    }
];

const activeServers = [];

function findAvailableServer() {
    return servers.find(server =>
        !activeServers.some(active => active.host === server.host && active.port === server.port)
    ) || null;
}

async function createMatchOnServer(matchData) {
    const availableServerConfig = findAvailableServer();
    if (!availableServerConfig) {
        throw new Error('Нет доступных серверов для создания матча.');
    }

    activeServers.push(availableServerConfig);

    // Устанавливаем RCON-соединение с сервером
    const server = await Rcon.connect({
        host: availableServerConfig.host,
        port: availableServerConfig.port,
        password: availableServerConfig.rconPassword
    });

    try {
        console.log(`Запускаем матч из URL: ${matchData.matchConfigUrl}`);
        await server.send(`ps_loadconfig "${matchData.matchConfigUrl}"`);

        console.log(`Матч ${matchData.gameId} успешно создан на сервере ${availableServerConfig.host}`);

        matchData.serverInstance = server;
        matchData.serverConfig = availableServerConfig;
        return availableServerConfig;
    } catch (error) {
        removeServerFromActive(availableServerConfig);
        console.error(`Ошибка при создании матча на сервере ${availableServerConfig.host}:`, error);

        await server.end();
        throw error;
    }
}

function removeServerFromActive(serverConfig) {
    const index = activeServers.findIndex(active =>
        active.host === serverConfig.host && active.port === serverConfig.port
    );
    if (index !== -1) {
        activeServers.splice(index, 1);
    }
}

async function endMatchOnServer(matchData, endDiscordCallback) {
    if (!matchData.serverInstance || !matchData.serverConfig) {
        console.warn("Нет информации о сервере для данного матча.");
        return;
    }
    try {
        console.log(`Завершаем игру на сервере ${matchData.serverConfig.host}`);
        // Отправляем команду для немедленной остановки матча (например, ps_stopmatch)
        await matchData.serverInstance.send("ps_stopmatch");
        // Завершаем RCON-соединение
        await matchData.serverInstance.end();

        removeServerFromActive(matchData.serverConfig);
        console.log(`Игра на сервере ${matchData.serverConfig.host} завершена.`);

        if (typeof endDiscordCallback === 'function') {
            await endDiscordCallback(matchData);
        }
    } catch (error) {
        console.error(`Ошибка при завершении игры на сервере ${matchData.serverConfig.host}:`, error);
        throw error;
    }
}

module.exports = {
    servers,
    activeServers,
    findAvailableServer,
    createMatchOnServer,
    endMatchOnServer
};