// cs2ServerController.js
const { Rcon } = require('rcon-client'); // Используем rcon-client вместо устаревшего PugSharp
const User = require('../models/user');

const servers = [
    {
        host: '178.253.55.109',
        port: 27015,
        rconPassword: 'DSMFKSaspdpKPpdsgfgSDFSDMDSMfksmd'
    }
];

const activeServers = [];

/**
 * Возвращает первый сервер, который не находится в activeServers.
 */
function findAvailableServer() {
    return servers.find(server =>
        !activeServers.some(active => active.host === server.host && active.port === server.port)
    ) || null;
}

/**
 * Создает матч на CS2 сервере:
 * 1. Находит доступный сервер и помечает его как занятый.
 * 2. Устанавливает карту, вайтлистит игроков.
 * 3. Запускает knife round, 5-минутный warmup, затем создает и стартует матч.
 *
 * @param {Object} matchData - Данные матча, содержащие:
 *    - gameId: идентификатор матча
 *    - finalMap: название карты (для смены уровня)
 *    - players: массив или Set userId участников
 *
 * @returns {Promise<boolean>} - true, если матч успешно создан.
 *
 * @throws {Error} - если нет доступных серверов или возникает другая ошибка.
 */
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
        console.log(`Устанавливаем карту "${matchData.finalMap}" на сервере ${availableServerConfig.host}:${availableServerConfig.port}`);
        // Смена карты: команда changelevel принимает map's code (например, mirage, dust2 и т.д.)
        await server.send(`changelevel ${matchData.finalMap}`);

        const players = Array.isArray(matchData.players)
            ? matchData.players
            : Array.from(matchData.players);

        // Вайтлистим каждого игрока по его SteamID
        for (const playerId of players) {
            const user = await User.findOne({ userId: playerId });
            if (!user) {
                console.warn(`Пользователь с userId ${playerId} не найден в БД.`);
                continue;
            }
            console.log(`Вайтлистим игрока с SteamID: ${user.steamId}`);
            await server.send(`whitelist_add ${user.steamId}`);
        }

        // Запускаем knife round
        console.log(`Запускаем knife round на сервере ${availableServerConfig.host}`);
        await server.send("knife_round_start");

        // Запускаем 5-минутный warmup
        console.log(`Запускаем 5-минутный warmup на сервере ${availableServerConfig.host}`);
        await server.send("mp_warmup_time 300");
        await server.send("mp_warmup_start");

        // Создаем матч по параметрам, используя команды из CounterstrikeSharp API

        // Если задан URL для конфигурации матча, загружаем её
        if (matchData.configUrl) {
            console.log(`Загружаем конфигурацию матча из URL: ${matchData.configUrl}`);
            // Если также передан authToken, добавляем его
            const tokenPart = matchData.authToken ? ` ${matchData.authToken}` : '';
            await server.send(`ps_loadconfig ${matchData.configUrl}${tokenPart}`);
        }
        // Если задан файл конфигурации, загружаем его
        else if (matchData.configFile) {
            console.log(`Загружаем конфигурацию матча из файла: ${matchData.configFile}`);
            await server.send(`ps_loadconfigfile ${matchData.configFile}`);
        }
        // Иначе создаем матч без предзагруженной конфигурации
        else {
            console.log(`Создаем матч без предзагруженной конфигурации`);
            await server.send("ps_creatematch");
        }

        if (matchData.playersPerTeam) {
            console.log(`Устанавливаем количество игроков в команде: ${matchData.playersPerTeam}`);
            await server.send(`ps_playersperteam ${matchData.playersPerTeam}`);
        }
        if (matchData.maxRounds) {
            console.log(`Устанавливаем максимальное количество раундов: ${matchData.maxRounds}`);
            await server.send(`ps_maxrounds ${matchData.maxRounds}`);
        }
        if (matchData.maxOvertimeRounds) {
            console.log(`Устанавливаем максимальное количество овертайм раундов: ${matchData.maxOvertimeRounds}`);
            await server.send(`ps_maxovertimerounds ${matchData.maxOvertimeRounds}`);
        }
        if (matchData.teamMode) {
            console.log(`Устанавливаем режим игры: ${matchData.teamMode}`);
            await server.send(`ps_teammode ${matchData.teamMode}`);
        }

        // Запускаем матч
        console.log(`Запускаем матч с помощью ps_startmatch на сервере ${availableServerConfig.host}`);
        await server.send("ps_startmatch");

        console.log(`Матч ${matchData.gameId} успешно создан на сервере ${availableServerConfig.host}`);

        matchData.serverInstance = server;
        matchData.serverConfig = availableServerConfig;
        return availableServerConfig;
    } catch (error) {
        removeServerFromActive(availableServerConfig);
        console.error(`Ошибка при создании матча на сервере ${availableServerConfig.host}:`, error);
        // Закрываем RCON-соединение при ошибке
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
