// cs2ServerController.js
const { Rcon } = require('rcon-client');
const User = require('../models/user');
const express = require('express');
const bodyParser = require('body-parser');
const Match = require('../models/match');
const { EmbedBuilder } = require('discord.js');

// Initialize Express app
const app = express();
app.use(bodyParser.json());

// Define port from environment variable or default to 3000
const PORT = process.env.PORT || 3000;

const servers = [
    {
        host: '178.253.55.109',
        port: 27015,
        rconPassword: 'DSMFKSaspdpKPpk23oko2k3oKPoDA345SMDSMfksmd'
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

    const server = await Rcon.connect({
        host: availableServerConfig.host,
        port: availableServerConfig.port,
        password: availableServerConfig.rconPassword
    });

    try {
        await server.send(`css_endmatch`);
        console.log(`Запускаем матч ${matchData.gameId} с картой ${matchData.finalMap}`);

        await server.send(`matchzy_loadmatch_url "${matchData.matchConfigUrl}"`);
        await server.send(`matchzy_remote_log_url "https://webhook.site/ee4aa84a-7e2d-40cd-aa00-f74a381f72c5"`);

        const response = await server.send(`status`);
        console.log(`Статус матча: ${response}`);

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

        await matchData.serverInstance.send("css_endmatch");

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

async function formatMatchConfig(matchData, teamObjectDB, client) {
    const team1Name = "Zombies";
    const team2Name = "Humans";

    const matchConfig = {
        matchid: matchData.gameId,
        num_maps: 1,
        maplist: [matchData.finalMap],
        players_per_team: Math.floor(teamObjectDB.players.length / 2),
        clinch_series: true,
        map_sides: ["knife"],
        team1: {
            name: team1Name,
            tag: "Zombie",
            flag: "RU",
            players: {}
        },
        team2: {
            name: team2Name,
            tag: "Human",
            flag: "RU",
            players: {}
        },
        spectators: {
            name: "Spectators",
            players: {}
        },
        cvars: {
            hostname: `Ketamine League: ${team1Name} vs ${team2Name} #${matchData.gameId}`,
            mp_overtime_enable: 1,
            mp_overtime_maxrounds: 6,
            mp_maxrounds: 24,
            mp_roundtime: 1.92,
            mp_autoteambalance: 0,
            sv_talk_enemy_dead: 0
        }
    };

    if (teamObjectDB && teamObjectDB.team1) {
        const team1Players = {};
        for (const [steamId, discordId] of teamObjectDB.team1.entries()) {
            try {
                const user = await client.users.fetch(discordId);
                team1Players[steamId] = user.displayName || user.username;
            } catch (err) {
                team1Players[steamId] = discordId;
            }
        }
        matchConfig.team1.players = team1Players;
    }

    if (teamObjectDB && teamObjectDB.team2) {
        const team2Players = {};
        for (const [steamId, discordId] of teamObjectDB.team2.entries()) {
            try {
                const user = await client.users.fetch(discordId);
                team2Players[steamId] = user.displayName || user.username;
            } catch (err) {
                team2Players[steamId] = discordId;
            }
        }
        matchConfig.team2.players = team2Players;
    }

    return matchConfig;
}

// API endpoint for match events
app.post('/api/match-event', async (req, res) => {
    try {
        const eventData = req.body;

        // Validate that this is a map_result event
        if (!eventData || eventData.event !== 'map_result') {
            console.log('Received non-map_result event:', eventData);
            return res.status(400).json({ error: 'Invalid event data' });
        }

        const matchId = eventData.matchid.toString();

        // Log the event
        console.log(`Получено событие окончания матча ${matchId}:`, JSON.stringify(eventData));

        // Retrieve the match record from database
        const matchRecord = await Match.findOne({ gameId: matchId });
        if (!matchRecord) {
            console.error(`Матч ${matchId} не найден в базе данных!`);
            return res.status(404).json({ error: 'Match not found' });
        }

        // Process match result
        const winnerTeam = eventData.winner.team;
        const team1Score = eventData.team1.score;
        const team2Score = eventData.team2.score;

        // Update match record with results
        matchRecord.matchResult = {
            winner: winnerTeam,
            team1Score,
            team2Score,
            mapNumber: eventData.map_number,
            completedAt: new Date()
        };

        await matchRecord.save();

        if (global.discordClient) {
            try {
                // Create the result embed
                const resultEmbed = new EmbedBuilder()
                    .setTitle(`Матч #${matchId} завершен!`)
                    .setDescription(`Карта: ${matchRecord.finalMap}`)
                    .addFields(
                        { name: 'Победитель', value: winnerTeam === 'team1' ? 'Zombies' : 'Humans', inline: true },
                        { name: 'Счет', value: `${team1Score} : ${team2Score}`, inline: true }
                    )
                    .setColor(winnerTeam === 'team1' ? 'Green' : 'Blue')
                    .setTimestamp();

                // Get all players from the match
                const allPlayers = matchRecord.players || [];

                // Send DM to each player
                for (const playerId of allPlayers) {
                    try {
                        const user = await global.discordClient.users.fetch(playerId);
                        if (user) {
                            await user.send({ embeds: [resultEmbed] });
                            console.log(`Уведомление о результате матча отправлено игроку ${user.username}`);
                        }
                    } catch (playerError) {
                        console.error(`Не удалось отправить уведомление игроку ${playerId}:`, playerError);
                    }
                }
            } catch (error) {
                console.error('Ошибка при отправке уведомлений о результате матча:', error);
            }
        }

        // Send success response
        return res.status(200).json({ success: true, message: 'Match result processed' });

    } catch (error) {
        console.error('Ошибка обработки события матча:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

function startServer(discordClient) {
    global.discordClient = discordClient;

    app.listen(PORT, () => {
        console.log(`CS2 Server Controller API running on port ${PORT}`);
    });
}

module.exports = {
    servers,
    activeServers,
    findAvailableServer,
    createMatchOnServer,
    endMatchOnServer,
    formatMatchConfig,
    startServer
};