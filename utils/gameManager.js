// gameManager.js

const { uuidv7 } = require('uuidv7');
const axios = require('axios');
const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const User = require('../models/user');
const Match = require('../models/match');

const { formatMatchConfig, createMatchOnServer, startServer } = require('./cs2ServerController');

// ================================
//            CONSTANTS
// ================================
const activeGames = new Map();

const MAPS = [
  { name: 'Mirage', code: 'de_mirage', emoji: '🏜️' },
  { name: 'Dust', code: 'de_dust2', emoji: '🌪️' },
  { name: 'Nuke', code: 'de_nuke', emoji: '☢️' },
  { name: 'Train', code: 'de_train', emoji: '🚂' },
  { name: 'Cache', code: 'de_cache', emoji: '🛡️' }
];

function generateStringHash(str) {
  let hash = 0;
  if (str.length === 0) return hash;

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  return Math.abs(hash);
}

// ================================
//      INITIAL LOAD OF GAMES
// ================================
(async () => {
  try {
    // Загружаем из БД все матчи в перечисленных стадиях
    const games = await Match.find({
      gameStage: { $in: ['waiting', 'readyCheck', 'draft', 'veto', 'teams_done'] }
    });

    games.forEach(doc => {
      // Если игра завершена (teams_done), team1/team2 могут быть Object(Map).
      // Но для внутренней логики драфта мы работаем с массивами Discord ID.
      // В "сыром" doc.team1 будет Map-объект, если уже финал.
      // Превращаем, если обнаружим, в пустой массив, т.к. драфт уже не нужен.
      const team1 = typeof doc.team1 === 'object' && !Array.isArray(doc.team1)
        ? []
        : (doc.team1 ?? []);
      const team2 = typeof doc.team2 === 'object' && !Array.isArray(doc.team2)
        ? []
        : (doc.team2 ?? []);

      const gameData = {
        gameId: doc.gameId,
        guildId: doc.guildId,
        lobbyId: doc.lobbyId,
        queueChannelId: doc.queueChannelId,
        requiredPlayers: doc.requiredPlayers,

        players: new Set(doc.players),
        readyPlayers: new Set(doc.readyPlayers),
        restPlayers: doc.restPlayers ?? [],
        team1, // внутренне храним как массив Discord ID
        team2,
        removedMaps: new Set(doc.removedMaps),

        finalMap: doc.finalMap,
        captain1: doc.captain1,
        captain2: doc.captain2,
        gameStage: doc.gameStage,
        vetoTurns: doc.vetoTurns,
        draftTurns: doc.draftTurns,

        team1ChannelId: doc.team1ChannelId,
        team2ChannelId: doc.team2ChannelId,

        embedMessageId: doc.embedMessageId,
        embedMessage: null
      };
      activeGames.set(gameData.gameId, gameData);
    });

    console.log(`Загружено активных игр: ${games.length}`);
  } catch (err) {
    console.error("Ошибка при загрузке активных игр:", err);
  }
})();

module.exports.activeGames = activeGames;

/**
 * Создаёт новую игру (запись в БД и объект в памяти).
 */
async function createNewGame({ guild, queueTextChannel, lobbyVoice, requiredPlayers }) {
  const gameId = generateStringHash(uuidv7());

  const gameData = {
    gameId,
    guildId: guild.id,
    lobbyId: lobbyVoice.id,
    queueChannelId: queueTextChannel.id,
    requiredPlayers,

    players: new Set(),
    readyPlayers: new Set(),
    restPlayers: [],
    team1: [], // массив Discord ID
    team2: [],
    removedMaps: new Set(),
    finalMap: null,

    captain1: null,
    captain2: null,
    gameStage: 'waiting',
    vetoTurns: 0,
    draftTurns: 0,

    team1ChannelId: null,
    team2ChannelId: null,

    embedMessage: null
  };

  activeGames.set(gameId, gameData);

  // Создаём embed-сообщение
  const embed = new EmbedBuilder()
    .setTitle(`Матч #${gameId} — Ожидание игроков`)
    .setDescription(getWaitingDescription(gameData))
    .setColor('Gold')
    .setFooter({ text: 'Зайдите в канал Lobby для участия.' });

  const msg = await queueTextChannel.send({ embeds: [embed] });
  gameData.embedMessage = msg;

  // Сохраняем в БД
  const matchRecord = new Match({
    gameId,
    guildId: guild.id,
    lobbyId: lobbyVoice.id,
    queueChannelId: queueTextChannel.id,
    requiredPlayers,
    gameStage: 'waiting',
    embedMessageId: msg.id
  });
  await matchRecord.save();

  return gameData;
}
module.exports.createNewGame = createNewGame;

/**
 * Восстанавливает embed-сообщения для активных матчей (если бот перезагружен).
 */
async function restoreActiveMatches(client) {
  startServer(client);

  const ongoingMatches = await Match.find({ gameStage: { $ne: 'teams_done' } });
  for (const matchDoc of ongoingMatches) {
    const team1 = typeof matchDoc.team1 === 'object' && !Array.isArray(matchDoc.team1)
      ? []
      : (matchDoc.team1 ?? []);
    const team2 = typeof matchDoc.team2 === 'object' && !Array.isArray(matchDoc.team2)
      ? []
      : (matchDoc.team2 ?? []);

    const gameData = {
      gameId: matchDoc.gameId,
      guildId: matchDoc.guildId,
      lobbyId: matchDoc.lobbyId,
      queueChannelId: matchDoc.queueChannelId,
      requiredPlayers: matchDoc.requiredPlayers,

      players: new Set(matchDoc.players),
      readyPlayers: new Set(matchDoc.readyPlayers),
      restPlayers: matchDoc.restPlayers ?? [],
      team1,
      team2,
      removedMaps: new Set(matchDoc.removedMaps),
      finalMap: matchDoc.finalMap,
      captain1: matchDoc.captain1,
      captain2: matchDoc.captain2,
      gameStage: matchDoc.gameStage,
      vetoTurns: matchDoc.vetoTurns,
      draftTurns: matchDoc.draftTurns,

      team1ChannelId: matchDoc.team1ChannelId,
      team2ChannelId: matchDoc.team2ChannelId,
      embedMessageId: matchDoc.embedMessageId,
      embedMessage: null
    };

    try {
      const guild = await client.guilds.fetch(gameData.guildId);
      const channel = guild.channels.cache.get(gameData.queueChannelId);
      if (channel && gameData.embedMessageId) {
        const restoredMsg = await channel.messages.fetch(gameData.embedMessageId);
        gameData.embedMessage = restoredMsg;
      }
    } catch (err) {
      console.error(`Не удалось восстановить embed-сообщение матча ${gameData.gameId}`, err);
    }

    activeGames.set(gameData.gameId, gameData);
    console.log(`Матч #${gameData.gameId} восстановлен из базы (стадия: ${gameData.gameStage}).`);
  }
}
module.exports.restoreActiveMatches = restoreActiveMatches;

/**
 * Отслеживает вход/выход участников в голосовой канал Lobby
 * и обновляет состояние матчей.
 */
async function manageLobbyJoinLeave(oldState, newState, client) {
  const leftChannel = oldState.channel;
  const joinedChannel = newState.channel;

  if (joinedChannel) {
    const member = newState.member;
    const isGameLobby = Array.from(activeGames.values()).some(
      game => game.lobbyId === joinedChannel.id
    );

    if (isGameLobby) {
      // Проверяем привязку Steam, если пользователь зашёл в Lobby
      try {
        const userRecord = await User.findOne({ userId: member.id });
        if (!userRecord || !userRecord.steamId) {
          await member.voice.setChannel(null, "Для участия необходимо привязать Steam аккаунт");
          if (member.send) {
            member.send("Для участия в игре необходимо привязать ваш Steam аккаунт. Используйте соответствующую команду для привязки.");
          }
          return;
        }

        // Если пользователь уже участвует в другом активном матче (не waiting), выкидываем
        for (const data of activeGames.values()) {
          if (
            data.players.has(member.id) &&
            data.lobbyId !== joinedChannel.id &&
            data.gameStage !== 'waiting'
          ) {
            await member.voice.setChannel(null, "Вы уже участвуете в другом активном матче");
            return;
          }
        }
      } catch (err) {
        console.error("Ошибка при проверке привязки Steam:", err);
        return;
      }
    }
  }

  let leftGameData = null;
  let joinedGameData = null;

  // Ищем игру (waiting), из которой пользователь вышел
  if (leftChannel) {
    for (const data of activeGames.values()) {
      if (data.lobbyId === leftChannel.id && data.gameStage === 'waiting') {
        leftGameData = data;
        break;
      }
    }
  }

  // Ищем игру (waiting), в которую пользователь зашёл
  if (joinedChannel) {
    for (const data of activeGames.values()) {
      if (data.lobbyId === joinedChannel.id && data.gameStage === 'waiting') {
        joinedGameData = data;
        break;
      }
    }
  }

  // Удаляем пользователя из старого waiting-лобби
  if (leftGameData) {
    leftGameData.players.delete(oldState.id);
    await updateMatchInDB(leftGameData.gameId, {
      players: Array.from(leftGameData.players)
    });
    await updateWaitingEmbed(leftGameData, client);
  }

  // Добавляем пользователя в новое waiting-лобби
  if (joinedGameData) {
    joinedGameData.players.add(newState.id);
    await updateMatchInDB(joinedGameData.gameId, {
      players: Array.from(joinedGameData.players)
    });
    await updateWaitingEmbed(joinedGameData, client);

    // Если набрали достаточно игроков, переходим к readyCheck
    if (joinedGameData.players.size >= joinedGameData.requiredPlayers) {
      const guild = await client.guilds.fetch(joinedGameData.guildId);
      const lobby = guild.channels.cache.get(joinedGameData.lobbyId);
      if (lobby) {
        // Перекрываем доступ для Everyone и опять разрешаем (хак, если хотим ограничить вход)
        await lobby.permissionOverwrites.edit(guild.roles.everyone, { Connect: false });
        await lobby.permissionOverwrites.edit(guild.roles.everyone, { Connect: true });
      }
      await startReadyCheck(joinedGameData, client);
    }
  }
}
module.exports.manageLobbyJoinLeave = manageLobbyJoinLeave;

/**
 * Обновляет embed "waiting".
 */
async function updateWaitingEmbed(gameData, client) {
  if (gameData.gameStage !== 'waiting') return;

  await fetchEmbedMessageIfNeeded(gameData, client);
  if (!gameData.embedMessage) return;

  const embed = new EmbedBuilder()
    .setTitle(`Матч #${gameData.gameId} — Ожидание игроков`)
    .setDescription(getWaitingDescription(gameData))
    .setColor('Gold')
    .setFooter({ text: 'Зайдите в канал Lobby для участия.' });

  await gameData.embedMessage.edit({ embeds: [embed], components: [] });
}

/**
 * Начинает этап readyCheck: всем игрокам нужно нажать "Я готов".
 */
async function startReadyCheck(gameData, client) {
  gameData.gameStage = 'readyCheck';
  gameData.readyPlayers.clear();

  await updateMatchInDB(gameData.gameId, {
    gameStage: gameData.gameStage,
    readyPlayers: []
  });

  await fetchEmbedMessageIfNeeded(gameData, client);
  if (!gameData.embedMessage) {
    console.error(`Embed-сообщение отсутствует для игры ${gameData.gameId}. Пропуск этапа readyCheck.`);
    return;
  }

  // Кнопка "Я готов!"
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ready_${gameData.gameId}`)
      .setLabel('Я готов!')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Primary)
  );

  const embed = new EmbedBuilder()
    .setTitle(`Матч #${gameData.gameId} — Подтверждение готовности`)
    .setDescription(getReadyDescriptionCheck(gameData))
    .setColor('Blue');

  await gameData.embedMessage.edit({
    embeds: [embed],
    components: [row]
  });

  // Таймер 15 секунд, если кто-то не нажал, убираем их и возвращаемся в waiting
  gameData.readyTimeout = setTimeout(async () => {
    const notReady = Array.from(gameData.players).filter(pid => !gameData.readyPlayers.has(pid));
    for (const nr of notReady) {
      gameData.players.delete(nr);
    }
    await updateMatchInDB(gameData.gameId, {
      players: Array.from(gameData.players),
      readyPlayers: Array.from(gameData.readyPlayers)
    });

    if (gameData.players.size < gameData.requiredPlayers) {
      await returnToWaitingStage(gameData, client);
    } else {
      await startDraftPhase(gameData, client);
    }
  }, 15000);
}
module.exports.startReadyCheck = startReadyCheck;

/**
 * Обработка кнопки "Я готов!"
 */
async function handleReadyCheck(interaction, gameId) {
  try {
    const gameData = activeGames.get(gameId);
    if (!gameData || gameData.gameStage !== 'readyCheck') {
      if (!interaction.replied && !interaction.deferred) {
        return await interaction.reply({ content: 'Сейчас не этап готовности!', ephemeral: true });
      }
      return;
    }

    if (!gameData.players.has(interaction.user.id)) {
      if (!interaction.replied && !interaction.deferred) {
        return await interaction.reply({ content: 'Вы не участвуете в этом матче.', ephemeral: true });
      }
      return;
    }

    // Defer the update to prevent interaction expiration
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate();
    }

    // Добавляем игрока в readyPlayers
    gameData.readyPlayers.add(interaction.user.id);

    await updateMatchInDB(gameData.gameId, {
      readyPlayers: Array.from(gameData.readyPlayers)
    });

    // Обновляем embed
    const embed = new EmbedBuilder()
      .setTitle(`Матч #${gameData.gameId} — Подтверждение готовности`)
      .setDescription(getReadyDescriptionCheck(gameData))
      .setColor('Blue');

    // Use editReply if already deferred
    if (interaction.deferred) {
      await interaction.editReply({
        embeds: [embed],
        components: interaction.message.components
      });
    } else if (!interaction.replied) {
      await interaction.update({
        embeds: [embed],
        components: interaction.message.components
      });
    }

    // Если все нажали "Я готов", сразу переходим дальше
    if (gameData.readyPlayers.size === gameData.players.size) {
      if (gameData.readyTimeout) {
        clearTimeout(gameData.readyTimeout);
        delete gameData.readyTimeout;
      }
      await startDraftPhase(gameData, interaction.client);
    }
  } catch (error) {
    console.error('Ошибка в handleReadyCheck:', error);
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: 'Произошла ошибка при обработке готовности!', ephemeral: true });
      } catch (replyErr) {
        console.error('Не удалось отправить сообщение об ошибке:', replyErr);
      }
    }
  }
}
module.exports.handleReadyCheck = handleReadyCheck;

/**
 * Не все игроки готовы – возвращаемся к "waiting".
 */
async function returnToWaitingStage(gameData, client) {
  gameData.gameStage = 'waiting';

  const guild = await client.guilds.fetch(gameData.guildId);
  const lobby = guild.channels.cache.get(gameData.lobbyId);
  if (lobby) {
    await lobby.permissionOverwrites.edit(guild.roles.everyone, { Connect: true });
  }

  await updateMatchInDB(gameData.gameId, {
    gameStage: 'waiting'
  });

  const embed = new EmbedBuilder()
    .setTitle(`Матч #${gameData.gameId} — Недостаточно готовых игроков!`)
    .setDescription(`Ожидаем новых. Осталось: ${gameData.players.size}/${gameData.requiredPlayers}`)
    .setColor('DarkRed');

  await fetchEmbedMessageIfNeeded(gameData, client);
  if (gameData.embedMessage) {
    await gameData.embedMessage.edit({ embeds: [embed], components: [] });
  }
}
module.exports.returnToWaitingStage = returnToWaitingStage;

/**
 * Этап "draft" – капитаны по очереди выбирают игроков из restPlayers
 */
async function startDraftPhase(gameData, client) {
  gameData.gameStage = 'draft';
  gameData.draftTurns = 0;

  // Если капитаны не выбраны, берём первых двух из списка
  if (!gameData.captain1 || !gameData.captain2) {
    const arr = Array.from(gameData.players);
    shuffleArray(arr);
    gameData.captain1 = arr[0];
    gameData.captain2 = arr[1];
    gameData.restPlayers = arr.slice(2);

    if (!gameData.team1.includes(gameData.captain1)) {
      gameData.team1.push(gameData.captain1);
    }
    if (!gameData.team2.includes(gameData.captain2)) {
      gameData.team2.push(gameData.captain2);
    }
  }

  await updateMatchInDB(gameData.gameId, {
    gameStage: gameData.gameStage,
    captain1: gameData.captain1,
    captain2: gameData.captain2,
    team1: gameData.team1,
    team2: gameData.team2,
    restPlayers: gameData.restPlayers
  });

  const guild = await client.guilds.fetch(gameData.guildId);

  // Если свободных < 2, драфт завершается сразу
  if (gameData.restPlayers.length < 2) {
    if (gameData.restPlayers.length === 1) {
      const onlyOne = gameData.restPlayers[0];
      if (gameData.team1.length <= gameData.team2.length) {
        gameData.team1.push(onlyOne);
      } else {
        gameData.team2.push(onlyOne);
      }
      gameData.restPlayers = [];
    }
    await updateMatchInDB(gameData.gameId, {
      team1: gameData.team1,
      team2: gameData.team2,
      restPlayers: gameData.restPlayers
    });
    await startVetoPhase(gameData, client);
    return;
  }

  // Генерируем embed с составом команд, капитанами и свободными игроками
  const team1Members = await Promise.all(
    gameData.team1.map(async pid => {
      const member = await guild.members.fetch(pid);
      return member.user.username;
    })
  );
  const team2Members = await Promise.all(
    gameData.team2.map(async pid => {
      const member = await guild.members.fetch(pid);
      return member.user.username;
    })
  );
  const currentCaptain = (gameData.draftTurns % 2 === 0) ? gameData.captain1 : gameData.captain2;
  const freePlayers = gameData.restPlayers.map(pid => `<@${pid}>`).join(', ') || '_нет_';

  const embed = new EmbedBuilder()
    .setTitle(`Матч #${gameData.gameId} — Драфт игроков`)
    .setDescription(
      `Капитаны: <@${gameData.captain1}> и <@${gameData.captain2}>\n` +
      `Сейчас ход: <@${currentCaptain}>\n\n` +
      `Команда капитана <@${gameData.captain1}>: ${team1Members.join(', ') || '_нет_'}\n` +
      `Команда капитана <@${gameData.captain2}>: ${team2Members.join(', ') || '_нет_'}\n\n` +
      `Свободные игроки: ${freePlayers}`
    )
    .setColor('Blue');

  // Кнопки для выбора каждого свободного игрока
  const buttons = [];
  for (const pid of gameData.restPlayers) {
    const member = await guild.members.fetch(pid);
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`pick_${gameData.gameId}_${pid}`)
        .setLabel(member.user.username)
        .setEmoji('🙋')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  const rows = createRowsForButtons(buttons, 5);

  await fetchEmbedMessageIfNeeded(gameData, client);
  if (!gameData.embedMessage) {
    console.error(`Embed отсутствует для игры ${gameData.gameId}. Пропуск драфта.`);
    return;
  }
  await gameData.embedMessage.edit({ embeds: [embed], components: rows });

  // Таймер 60 секунд – если капитан не выбрал, выбираем случайно
  gameData.draftTimeout = setTimeout(async () => {
    if (gameData.restPlayers.length > 0) {
      const randomIndex = Math.floor(Math.random() * gameData.restPlayers.length);
      const autoPickId = gameData.restPlayers[randomIndex];
      await processDraftPick(gameData, autoPickId, client, guild, null);
    }
  }, 60000);
}
module.exports.startDraftPhase = startDraftPhase;

/**
 * Выполняет "пик" игрока (добавляет в team1/team2).
 */
async function processDraftPick(gameData, pickPlayerId, client, guild, interaction = null) {
  const isC1Turn = (gameData.draftTurns % 2 === 0);
  const currentCaptain = isC1Turn ? gameData.captain1 : gameData.captain2;

  // Если есть interaction, проверяем, что нажал правильный капитан
  if (interaction && interaction.user.id !== currentCaptain) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Сейчас ход другого капитана!', ephemeral: true });
    }
    return;
  }

  const idx = gameData.restPlayers.indexOf(pickPlayerId);
  if (idx === -1) {
    if (interaction && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Этот игрок уже выбран!', ephemeral: true });
    }
    return;
  }

  // Убираем игрока из свободных
  gameData.restPlayers.splice(idx, 1);

  // Добавляем в команду капитана
  if (isC1Turn) {
    gameData.team1.push(pickPlayerId);
  } else {
    gameData.team2.push(pickPlayerId);
  }
  gameData.draftTurns++;

  // Сохраняем
  await updateMatchInDB(gameData.gameId, {
    team1: gameData.team1,
    team2: gameData.team2,
    restPlayers: gameData.restPlayers,
    draftTurns: gameData.draftTurns
  });

  // Формируем обновлённый embed
  const newCurrentCaptain = (gameData.draftTurns % 2 === 0)
    ? gameData.captain1
    : gameData.captain2;

  const team1Members = await Promise.all(gameData.team1.map(async pid => {
    const member = await guild.members.fetch(pid);
    return member.user.username;
  }));
  const team2Members = await Promise.all(gameData.team2.map(async pid => {
    const member = await guild.members.fetch(pid);
    return member.user.username;
  }));
  const freePlayers = gameData.restPlayers.map(pid => `<@${pid}>`).join(', ') || '_нет_';

  const embedDescription = `Капитаны: <@${gameData.captain1}> и <@${gameData.captain2}>\n` +
    `Сейчас ход: <@${newCurrentCaptain}>\n\n` +
    `Команда капитана <@${gameData.captain1}>: ${team1Members.join(', ') || '_нет_'}\n` +
    `Команда капитана <@${gameData.captain2}>: ${team2Members.join(', ') || '_нет_'}\n\n` +
    `Свободные игроки: ${freePlayers}`;

  const embed = new EmbedBuilder()
    .setTitle(`Матч #${gameData.gameId} — Драфт игроков`)
    .setDescription(embedDescription)
    .setColor('Blue');

  // Отключаем/обновляем кнопки
  const oldRows = gameData.embedMessage.components;
  const newRows = [];
  for (const row of oldRows) {
    const row2 = new ActionRowBuilder();
    for (const c of row.components) {
      const btn = ButtonBuilder.from(c);
      const id = btn.data?.custom_id;
      if (!id) {
        row2.addComponents(btn);
        continue;
      }
      const [act, gId, pId] = id.split('_');
      if (pId === pickPlayerId) {
        btn.setDisabled(true).setStyle(ButtonStyle.Danger);
      }
      if (!gameData.restPlayers.includes(pId)) {
        btn.setDisabled(true);
      }
      row2.addComponents(btn);
    }
    newRows.push(row2);
  }

  // Если это был interaction, обновляем через update. Иначе – через edit.
  if (interaction) {
    if (interaction.deferred) {
      await interaction.editReply({ embeds: [embed], components: newRows });
    } else if (!interaction.replied) {
      await interaction.update({ embeds: [embed], components: newRows });
    }
  } else {
    await gameData.embedMessage.edit({ embeds: [embed], components: newRows });
  }

  // Сбрасываем текущий таймер и устанавливаем новый, если остаются игроки
  if (gameData.draftTimeout) {
    clearTimeout(gameData.draftTimeout);
    delete gameData.draftTimeout;
  }

  if (gameData.restPlayers.length === 1) {
    const lonePid = gameData.restPlayers[0];
    if (gameData.team1.length <= gameData.team2.length) {
      gameData.team1.push(lonePid);
    } else {
      gameData.team2.push(lonePid);
    }
    gameData.restPlayers = [];
    await updateMatchInDB(gameData.gameId, {
      team1: gameData.team1,
      team2: gameData.team2,
      restPlayers: []
    });
    await startVetoPhase(gameData, client);
    return;
  } else if (gameData.restPlayers.length === 0) {
    await startVetoPhase(gameData, client);
    return;
  }

  // Новый таймер на 60 секунд
  gameData.draftTimeout = setTimeout(async () => {
    if (gameData.restPlayers.length > 0) {
      const randomIndex = Math.floor(Math.random() * gameData.restPlayers.length);
      const autoPickId = gameData.restPlayers[randomIndex];
      await processDraftPick(gameData, autoPickId, client, guild, null);
    }
  }, 60000);
}

/**
 * Экспорт обработки каптанского "пика" через кнопку.
 */
const handlePickInteraction = async function (interaction, gameId, pickPlayerId) {
  try {
    const gameData = activeGames.get(gameId);
    if (!gameData || gameData.gameStage !== 'draft') {
      if (!interaction.replied && !interaction.deferred) {
        return await interaction.reply({ content: 'Сейчас не стадия драфта!', ephemeral: true });
      }
      return;
    }

    // Defer update if not already replied/deferred
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate();
    }

    const guild = await interaction.guild;
    await processDraftPick(gameData, pickPlayerId, interaction.client, guild, interaction);
  } catch (error) {
    console.error('Ошибка в handlePickInteraction:', error);
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: 'Произошла ошибка при выборе игрока!', ephemeral: true });
      } catch (replyErr) {
        console.error('Не удалось отправить сообщение об ошибке:', replyErr);
      }
    }
  }
};
module.exports.handlePickInteraction = handlePickInteraction;

/**
 * Начинаем этап "вето карт": капитаны по очереди убирают карты, пока не останется одна.
 */
async function startVetoPhase(gameData, client) {
  gameData.gameStage = 'veto';
  gameData.removedMaps = new Set();
  gameData.vetoTurns = 0;

  await updateMatchInDB(gameData.gameId, {
    gameStage: 'veto',
    removedMaps: [],
    vetoTurns: 0
  });

  const guild = await client.guilds.fetch(gameData.guildId);
  const currentCaptain = (gameData.vetoTurns % 2 === 0) ? gameData.captain1 : gameData.captain2;
  const embed = new EmbedBuilder()
    .setTitle(`Матч #${gameData.gameId} — Вето карт`)
    .setDescription(
      `Капитаны: <@${gameData.captain1}> и <@${gameData.captain2}>\n` +
      `Сейчас ход: <@${currentCaptain}>\n\n` +
      `По очереди убирают карты. Когда останется 1 — этап завершён.`
    )
    .setColor('Orange');

  const buttons = MAPS.map(m =>
    new ButtonBuilder()
      .setCustomId(`veto_${gameData.gameId}_${m.name}`)
      .setLabel(m.name)
      .setEmoji(m.emoji)
      .setStyle(ButtonStyle.Secondary)
  );
  const rows = createRowsForButtons(buttons, 5);

  await fetchEmbedMessageIfNeeded(gameData, client);
  if (!gameData.embedMessage) {
    console.error(`Embed отсутствует для игры ${gameData.gameId}. Пропуск вето.`);
    return;
  }

  await gameData.embedMessage.edit({ embeds: [embed], components: rows });
}
module.exports.startVetoPhase = startVetoPhase;

/**
 * Обработка кнопки "veto_{gameId}_{mapName}"
 */
async function handleVetoInteraction(interaction, gameId, mapName) {
  try {
    const gameData = activeGames.get(gameId);
    if (!gameData || gameData.gameStage !== 'veto') {
      if (!interaction.replied && !interaction.deferred) {
        return await interaction.reply({ content: 'Сейчас не стадия вето!', ephemeral: true });
      }
      return;
    }

    const isC1Turn = (gameData.vetoTurns % 2 === 0);
    const currentCaptain = isC1Turn ? gameData.captain1 : gameData.captain2;
    if (interaction.user.id !== currentCaptain) {
      if (!interaction.replied && !interaction.deferred) {
        return await interaction.reply({ content: 'Сейчас ход другого капитана!', ephemeral: true });
      }
      return;
    }

    // Defer update if not already replied/deferred
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate();
    }

    gameData.removedMaps.add(mapName);
    gameData.vetoTurns++;

    await updateMatchInDB(gameData.gameId, {
      removedMaps: Array.from(gameData.removedMaps),
      vetoTurns: gameData.vetoTurns
    });

    // Отключаем кнопку убранной карты
    const oldRows = interaction.message.components;
    const newRows = [];
    for (const row of oldRows) {
      const row2 = new ActionRowBuilder();
      for (const c of row.components) {
        const btn = ButtonBuilder.from(c);
        const id = btn.data?.custom_id;
        if (!id) {
          continue;
        }
        const [act, gId, thisMap] = id.split('_');
        if (thisMap === mapName) {
          btn.setStyle(ButtonStyle.Danger).setDisabled(true);
        }
        if (gameData.removedMaps.has(thisMap)) {
          btn.setDisabled(true);
        }
        row2.addComponents(btn);
      }
      newRows.push(row2);
    }

    const mapsLeft = MAPS.map(m => m.name).filter(name => !gameData.removedMaps.has(name));
    if (mapsLeft.length > 1) {
      // Update with current captain
      const currentCaptainAfter = (gameData.vetoTurns % 2 === 0) ? gameData.captain1 : gameData.captain2;
      const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setDescription(
          `Капитаны: <@${gameData.captain1}> и <@${gameData.captain2}>\n` +
          `Сейчас ход: <@${currentCaptainAfter}>\n\n` +
          `По очереди убирают карты. Когда останется 1 — этап завершён.`
        );
      await interaction.editReply({ embeds: [updatedEmbed], components: newRows });
    } else {
      // Осталась одна карта
      const selectedMapName = mapsLeft[0];
      const selectedMap = MAPS.find(m => m.name === selectedMapName);
      gameData.finalMap = selectedMap ? selectedMap.code : selectedMapName;

      // Обновляем UI, показываем финальную карту зелёным
      const finalRows = [];
      for (const row of newRows) {
        const row2 = new ActionRowBuilder();
        for (const c of row.components) {
          const btn = ButtonBuilder.from(c);
          const id = btn.data?.custom_id;
          if (!id) {
            row2.addComponents(btn);
            continue;
          }
          const [act, gId, thisMap] = id.split('_');
          if (thisMap === selectedMapName) {
            btn.setStyle(ButtonStyle.Success);
          }
          btn.setDisabled(true);
          row2.addComponents(btn);
        }
        finalRows.push(row2);
      }
      await interaction.editReply({ components: finalRows });

      await updateMatchInDB(gameData.gameId, {
        finalMap: gameData.finalMap
      });

      // Add delay before finalizing teams
      setTimeout(async () => {
        await finalizeTeams(gameData, interaction.client);
      }, 1000);
    }
  } catch (error) {
    console.error(`Ошибка при обработке вето:`, error);
    try {
      // Only attempt to reply if interaction hasn't been replied to
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'Произошла ошибка при обработке вето. Попробуйте еще раз.',
          ephemeral: true
        });
      }
    } catch (replyError) {
      console.error('Ошибка при отправке сообщения об ошибке:', replyError);
    }
  }
}

module.exports.handleVetoInteraction = handleVetoInteraction;

/**
 * Завершение формирования команд:
 * - Создаём отдельные голосовые каналы team1/team2
 * - Переносим туда игроков
 * - Запускаем матч на CS2-сервере (опционально)
 * - При сохранении в БД team1/team2 становятся объектом { steamId: discordName }
 */
async function finalizeTeams(gameData, client) {
  gameData.gameStage = 'teams_done';

  const guild = await client.guilds.fetch(gameData.guildId);
  const lobby = guild.channels.cache.get(gameData.lobbyId);

  // Удаляем старые каналы, если есть
  if (gameData.team1ChannelId) {
    const ch1 = guild.channels.cache.get(gameData.team1ChannelId);
    if (ch1) await ch1.delete().catch(() => { });
  }
  if (gameData.team2ChannelId) {
    const ch2 = guild.channels.cache.get(gameData.team2ChannelId);
    if (ch2) await ch2.delete().catch(() => { });
  }

  // Создаем категорию, если нужно
  let category = lobby?.parent ?? null;
  if (!category || category.type !== ChannelType.GuildCategory) {
    category = await guild.channels.create({
      name: 'GAME_LOBBY',
      type: ChannelType.GuildCategory
    });
  }

  // Создаём голосовые каналы для каждой команды
  const team1Channel = await guild.channels.create({
    name: 'Team 1',
    type: ChannelType.GuildVoice,
    parent: category.id,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.Connect] }
    ]
  });
  const team2Channel = await guild.channels.create({
    name: 'Team 2',
    type: ChannelType.GuildVoice,
    parent: category.id,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.Connect] }
    ]
  });

  gameData.team1ChannelId = team1Channel.id;
  gameData.team2ChannelId = team2Channel.id;

  // Переносим игроков из lobby в их командные каналы
  for (const pid of gameData.players) {
    const member = await guild.members.fetch(pid);
    if (member?.voice?.channel?.id === lobby?.id) {
      if (gameData.team1.includes(pid)) {
        await member.voice.setChannel(team1Channel);
      } else {
        await member.voice.setChannel(team2Channel);
      }
    }
  }

  await updateMatchInDB(gameData.gameId, {
    gameStage: 'teams_done',
    team1ChannelId: gameData.team1ChannelId,
    team2ChannelId: gameData.team2ChannelId,
    players: Array.from(gameData.players),
    team1: gameData.team1,
    team2: gameData.team2,
    finalMap: gameData.finalMap
  });

  // Удаляем embed
  try {
    await gameData.embedMessage?.delete();
  } catch (err) {
    console.error('Не удалось удалить embed:', err);
  }

  const teamObjectDB = await Match.findOne({ gameId: gameData.gameId });
  let matchInfo;
  try {
    const matchConfig = await formatMatchConfig(
      {
        gameId: gameData.gameId,
        finalMap: gameData.finalMap
      },
      teamObjectDB,
      client
    );

    const matchConfigResponse = await axios.post('https://763487648764376983479586.cfd/postText', {
      text: JSON.stringify(matchConfig)
    });

    const configId = matchConfigResponse?.data?.id;
    if (!configId) {
      throw new Error('Failed to get config ID from response');
    }

    matchInfo = await createMatchOnServer({
      gameId: gameData.gameId,
      finalMap: gameData.finalMap,
      matchConfigUrl: `https://763487648764376983479586.cfd/getText/${configId}`
    });
    console.log(`Матч #${gameData.gameId} успешно запущен на CS2-сервере с MatchZy.`);
  } catch (error) {
    console.error(`Не удалось запустить матч #${gameData.gameId} на CS2-сервере:`, error);
  }

  // In the finalizeTeams function, update the connect message part:
  if (matchInfo) {
    for (const pid of gameData.players) {
      try {
        const user = await client.users.fetch(pid);
        if (user) {
          const connectEmbed = new EmbedBuilder()
            .setTitle("Подключитесь к матчу!")
            .setDescription(
              `Match ID: **${gameData.gameId}**\n\n` +
              `Введите команду:\n\`\`\`bash\nconnect ${matchInfo.host}:${matchInfo.port}\n\`\`\``
            )
            .setColor("Green")
            .setFooter({ text: "Удачи в игре!" });
          await user.send({ embeds: [connectEmbed] });
        }
      } catch (err) {
        console.error(`Не удалось отправить сообщение пользователю ${pid}:`, err);
      }
    }
  }

  // Удаляем игру из памяти
  activeGames.delete(gameData.gameId);

  // Автоматически создаём новый матч в том же канале
  const queueChannel = guild.channels.cache.get(gameData.queueChannelId);
  if (queueChannel) {
    try {
      const { createNewGame } = require('./gameManager');
      await createNewGame({
        guild,
        queueTextChannel: queueChannel,
        lobbyVoice: lobby,
        requiredPlayers: gameData.requiredPlayers
      });
      console.log(`Создан новый матч автоматически (requiredPlayers=${gameData.requiredPlayers}).`);
    } catch (err) {
      console.error('Не удалось создать новый матч:', err);
    }
  }
}
module.exports.finalizeTeams = finalizeTeams;

/**
 * ================================
 *          HELPER FUNCTIONS
 * ================================
 */

/**
 * Получает embedMessage, если оно отсутствует в памяти.
 */
async function fetchEmbedMessageIfNeeded(gameData, client) {
  if (gameData.embedMessage) return;
  if (!gameData.embedMessageId) return;

  try {
    const guild = await client.guilds.fetch(gameData.guildId);
    const channel = guild.channels.cache.get(gameData.queueChannelId);
    if (!channel) return;
    const msg = await channel.messages.fetch(gameData.embedMessageId);
    gameData.embedMessage = msg;
  } catch (err) {
    console.error(`Не удалось восстановить embed для игры ${gameData.gameId}:`, err);
  }
}

/**
 * Формирует описание для лобби (staging = 'waiting').
 */
function getWaitingDescription(gameData) {
  const cnt = gameData.players.size;
  const req = gameData.requiredPlayers;
  const list = Array.from(gameData.players).map(p => `<@${p}>`).join('\n');
  return `Нужно игроков: **${req}**\nУже в Lobby (${cnt}):\n${list || '_никого нет_'}\n`;
}

/**
 * Формирует описание для этапа readyCheck.
 */
function getReadyDescriptionCheck(gameData) {
  let desc = `Нажмите "Я готов!" в течение 15 секунд.\n\n`;
  for (const pid of gameData.players) {
    desc += gameData.readyPlayers.has(pid)
      ? `<@${pid}> ✅\n`
      : `<@${pid}> ❌\n`;
  }
  return desc;
}

/**
 * Преобразует массив Discord ID в объект вида { steamId: discordName }
 */
async function transformTeam(discordIdArray) {
  const obj = {};
  for (const discordId of discordIdArray) {
    const userRecord = await User.findOne({ userId: discordId });
    if (userRecord && userRecord.steamId) {
      obj[userRecord.steamId] = userRecord.username || discordId;
    } else {
      // если не нашли steamId, то пишем discordId как ключ
      obj[discordId] = discordId;
    }
  }
  return obj;
}

async function updateMatchInDB(gameId, updateObj) {
  // 1) Преобразуем Set -> Array
  // 2) Если gameStage !== 'teams_done', убираем team1/team2 из updateObj 
  //    (чтобы не пытаться сохранять массивы в Map)

  const finalUpdate = {};
  for (const [k, v] of Object.entries(updateObj)) {
    if (v instanceof Set) {
      finalUpdate[k] = Array.from(v);
    } else {
      finalUpdate[k] = v;
    }
  }

  // Если stage НЕ teams_done, вырезаем team1/team2 из finalUpdate
  // чтобы не сохранить туда массив вместо Map
  if (finalUpdate.gameStage !== 'teams_done') {
    delete finalUpdate.team1;
    delete finalUpdate.team2;
  }

  // Если stage == 'teams_done', то предполагаем, что team1/team2 — это массив Discord ID,
  // и нужно transformTeam -> Map
  if (finalUpdate.gameStage === 'teams_done') {
    if (Array.isArray(finalUpdate.team1)) {
      finalUpdate.team1 = await transformTeam(finalUpdate.team1);
    }
    if (Array.isArray(finalUpdate.team2)) {
      finalUpdate.team2 = await transformTeam(finalUpdate.team2);
    }
  }

  try {
    await Match.findOneAndUpdate(
      { gameId },
      { $set: finalUpdate },
      { new: true, runValidators: true }
    );
  } catch (err) {
    console.error(`Не удалось обновить Match (gameId=${gameId}):`, err);
  }
}

/**
 * Создаёт ряды кнопок (по 5 на строку).
 */
function createRowsForButtons(buttons, perRow = 5) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += perRow) {
    const slice = buttons.slice(i, i + perRow);
    const row = new ActionRowBuilder().addComponents(slice);
    rows.push(row);
  }
  return rows;
}

/**
 * Перемешивает массив (алгоритм Фишера–Йетса).
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

module.exports = {
  activeGames,
  createNewGame,
  restoreActiveMatches,
  manageLobbyJoinLeave,
  startReadyCheck,
  handleReadyCheck,
  returnToWaitingStage,
  startDraftPhase,
  handlePickInteraction,
  startVetoPhase,
  handleVetoInteraction,
  finalizeTeams
};
