// gameManager.js
const { uuidv7 } = require('uuidv7');
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

// Импортируем наш новый контроллер для CS2-серверов
const {
  createMatchOnServer,
  endMatchOnServer
} = require('./cs2ServerController');

const activeGames = new Map();

(async () => {
  try {
    const games = await Match.find({
      gameStage: { $in: ['waiting', 'readyCheck', 'draft', 'veto', 'teams_done'] }
    });
    games.forEach(doc => {
      const gameData = {
        gameId: doc.gameId,
        guildId: doc.guildId,
        lobbyId: doc.lobbyId,
        queueChannelId: doc.queueChannelId,
        requiredPlayers: doc.requiredPlayers,

        players: new Set(doc.players),
        readyPlayers: new Set(doc.readyPlayers),
        restPlayers: doc.restPlayers ?? [],
        team1: doc.team1 ?? [],
        team2: doc.team2 ?? [],
        removedMaps: new Set(doc.removedMaps),

        finalMap: doc.finalMap,
        captain1: doc.captain1,
        captain2: doc.captain2,
        gameStage: doc.gameStage,
        vetoTurns: doc.vetoTurns,
        draftTurns: doc.draftTurns,

        team1ChannelId: doc.team1ChannelId,
        team2ChannelId: doc.team2ChannelId,

        // Сохраняем embedMessageId, чтобы в дальнейшем можно было восстановить embed-сообщение
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

// Возможные карты
const MAPS = [
  { name: 'Mirage', code: 'de_mirage', emoji: '🏜️' },
  { name: 'Dust', code: 'de_dust2', emoji: '🌪️' },
  { name: 'Nuke', code: 'de_nuke', emoji: '☢️' },
  { name: 'Train', code: 'de_train', emoji: '🚂' },
];

/**
 * Создаем новый матч и помещаем его в activeGames.
 * Также создаём документ в БД (коллекция Match).
 */
async function createNewGame({ guild, queueTextChannel, lobbyVoice, requiredPlayers }) {
  const gameId = uuidv7();

  const gameData = {
    gameId,
    guildId: guild.id,
    lobbyId: lobbyVoice.id,
    queueChannelId: queueTextChannel.id,
    requiredPlayers,

    players: new Set(),
    readyPlayers: new Set(),
    restPlayers: [],
    team1: [],
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

  const embed = new EmbedBuilder()
    .setTitle(`Матч #${gameId} — Ожидание игроков`)
    .setDescription(getWaitingDescription(gameData))
    .setColor('Gold')
    .setFooter({ text: 'Зайдите в канал Lobby для участия.' });

  const msg = await queueTextChannel.send({ embeds: [embed] });
  gameData.embedMessage = msg;

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
 * При необходимости вызывается, чтобы восстановить embed-сообщения
 * для матчей, у которых оно отсутствует в памяти (gameData.embedMessage = null).
 */
async function restoreActiveMatches(client) {
  const ongoingMatches = await Match.find({ gameStage: { $ne: 'teams_done' } });
  for (const matchDoc of ongoingMatches) {
    const gameData = {
      gameId: matchDoc.gameId,
      guildId: matchDoc.guildId,
      lobbyId: matchDoc.lobbyId,
      queueChannelId: matchDoc.queueChannelId,
      requiredPlayers: matchDoc.requiredPlayers,

      players: new Set(matchDoc.players),
      readyPlayers: new Set(matchDoc.readyPlayers),
      restPlayers: matchDoc.restPlayers ?? [],
      team1: matchDoc.team1 ?? [],
      team2: matchDoc.team2 ?? [],
      removedMaps: new Set(matchDoc.removedMaps),
      finalMap: matchDoc.finalMap,
      captain1: matchDoc.captain1,
      captain2: matchDoc.captain2,
      gameStage: matchDoc.gameStage,
      vetoTurns: matchDoc.vetoTurns,
      draftTurns: matchDoc.draftTurns,

      team1ChannelId: matchDoc.team1ChannelId,
      team2ChannelId: matchDoc.team2ChannelId,
      embedMessage: null
    };

    try {
      const guild = await client.guilds.fetch(gameData.guildId);
      const channel = guild.channels.cache.get(gameData.queueChannelId);
      if (channel) {
        const restoredMsg = await channel.messages.fetch(matchDoc.embedMessageId);
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
 * Функция для формирования описания матча на этапе "waiting".
 */
function getWaitingDescription(gameData) {
  const cnt = gameData.players.size;
  const req = gameData.requiredPlayers;
  const list = Array.from(gameData.players).map(p => `<@${p}>`).join('\n');
  return `Нужно игроков: **${req}**\nУже в Lobby (${cnt}):\n${list || '_никого нет_'}\n`;
}

/**
 * Отслеживает вход/выход игроков в/из голосового канала Lobby,
 * обновляет списки игроков в activeGames и в БД.
 */
async function manageLobbyJoinLeave(oldState, newState, client) {
  const leftChannel = oldState.channel;
  const joinedChannel = newState.channel;

  // Проверка привязки Steam и блокировки, только если канал - игровой Lobby
  if (joinedChannel) {
    const member = newState.member;
    const isGameLobby = Array.from(activeGames.values()).some(
      game => game.lobbyId === joinedChannel.id
    );

    if (isGameLobby) {
      try {
        const userRecord = await User.findOne({ userId: member.id });
        if (!userRecord || !userRecord.steamId) {
          await member.voice.setChannel(null, "Для участия необходимо привязать Steam аккаунт");
          if (member.send) {
            member.send("Для участия в игре необходимо привязать ваш Steam аккаунт. Используйте соответствующую команду для привязки.");
          }
          return;
        }

        // Если пользователь уже играет в другом матче (не на этапе waiting), выкидываем
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

  // Ищем игру, из которой пользователь вышел (только если там стадия waiting)
  if (leftChannel) {
    for (const data of activeGames.values()) {
      if (data.lobbyId === leftChannel.id && data.gameStage === 'waiting') {
        leftGameData = data;
        break;
      }
    }
  }

  // Ищем игру, в которую пользователь зашёл (только если там стадия waiting)
  if (joinedChannel) {
    for (const data of activeGames.values()) {
      if (data.lobbyId === joinedChannel.id && data.gameStage === 'waiting') {
        joinedGameData = data;
        break;
      }
    }
  }

  // Удаляем игрока из старого лобби
  if (leftGameData) {
    leftGameData.players.delete(oldState.id);
    await updateMatchInDB(leftGameData.gameId, {
      players: Array.from(leftGameData.players)
    });
    await updateWaitingEmbed(leftGameData, client);
  }

  // Добавляем игрока в новое лобби
  if (joinedGameData) {
    joinedGameData.players.add(newState.id);
    await updateMatchInDB(joinedGameData.gameId, {
      players: Array.from(joinedGameData.players)
    });
    await updateWaitingEmbed(joinedGameData, client);

    // Если набралось достаточно игроков, переходим к readyCheck
    if (joinedGameData.players.size >= joinedGameData.requiredPlayers) {
      const guild = await client.guilds.fetch(joinedGameData.guildId);
      const lobby = guild.channels.cache.get(joinedGameData.lobbyId);
      if (lobby) {
        await lobby.permissionOverwrites.edit(guild.roles.everyone, { Connect: false });
        await lobby.permissionOverwrites.edit(guild.roles.everyone, { Connect: true });
      }
      await startReadyCheck(joinedGameData, client);
    }
  }
}
module.exports.manageLobbyJoinLeave = manageLobbyJoinLeave;

/**
 * Обновление эмбеда лобби (waiting).
 * Восстанавливает embedMessage, если оно отсутствует в памяти.
 */
async function updateWaitingEmbed(gameData, client) {
  if (gameData.gameStage !== 'waiting') return;

  // Если embedMessage отсутствует, пытаемся восстановить
  if (!gameData.embedMessage && gameData.embedMessageId) {
    try {
      const guild = await client.guilds.fetch(gameData.guildId);
      const channel = guild.channels.cache.get(gameData.queueChannelId);
      if (channel) {
        const msg = await channel.messages.fetch(gameData.embedMessageId);
        gameData.embedMessage = msg;
      }
    } catch (err) {
      console.error(`Не удалось восстановить embed для игры ${gameData.gameId}:`, err);
      return;
    }
  }
  if (!gameData.embedMessage) return;

  const embed = new EmbedBuilder()
    .setTitle(`Матч #${gameData.gameId} — Ожидание игроков`)
    .setDescription(getWaitingDescription(gameData))
    .setColor('Gold')
    .setFooter({ text: 'Зайдите в канал Lobby для участия.' });

  await gameData.embedMessage.edit({ embeds: [embed], components: [] });
}

/**
 * Начало этапа "readyCheck". Устанавливаем stage и ждём подтверждения всех игроков.
 */
async function startReadyCheck(gameData, client) {
  gameData.gameStage = 'readyCheck';
  gameData.readyPlayers.clear();

  await updateMatchInDB(gameData.gameId, {
    gameStage: gameData.gameStage,
    readyPlayers: []
  });

  // Попытка восстановить embedMessage, если нужно
  if (!gameData.embedMessage && gameData.embedMessageId) {
    try {
      const guild = await client.guilds.fetch(gameData.guildId);
      const channel = guild.channels.cache.get(gameData.queueChannelId);
      if (channel) {
        const msg = await channel.messages.fetch(gameData.embedMessageId);
        gameData.embedMessage = msg;
      }
    } catch (e) {
      console.error(`Не удалось восстановить embed-сообщение для игры ${gameData.gameId}:`, e);
    }
  }
  if (!gameData.embedMessage) {
    console.error(`Embed-сообщение отсутствует для игры ${gameData.gameId}. Пропуск этапа readyCheck.`);
    return;
  }

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

  // Таймер на 15 секунд для подтверждения
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
 * Формирует описание для эмбеда этапа readyCheck.
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
 * Обработка нажатия кнопки "Я готов!"
 */
async function handleReadyCheck(interaction, gameId) {
  const gameData = activeGames.get(gameId);
  if (!gameData || gameData.gameStage !== 'readyCheck') {
    return interaction.reply({ content: 'Сейчас не этап готовности!', ephemeral: true });
  }
  if (!gameData.players.has(interaction.user.id)) {
    return interaction.reply({ content: 'Вы не участвуете в этом матче.', ephemeral: true });
  }

  gameData.readyPlayers.add(interaction.user.id);

  await updateMatchInDB(gameData.gameId, {
    readyPlayers: Array.from(gameData.readyPlayers)
  });

  const embed = new EmbedBuilder()
    .setTitle(`Матч #${gameData.gameId} — Подтверждение готовности`)
    .setDescription(getReadyDescriptionCheck(gameData))
    .setColor('Blue');

  await interaction.update({
    embeds: [embed],
    components: interaction.message.components
  });

  // Если все подтвердили готовность, двигаемся дальше
  if (gameData.readyPlayers.size === gameData.players.size) {
    if (gameData.readyTimeout) {
      clearTimeout(gameData.readyTimeout);
      delete gameData.readyTimeout;
    }
    await startDraftPhase(gameData, interaction.client);
  }
}
module.exports.handleReadyCheck = handleReadyCheck;

/**
 * Возвращаемся к "waiting", если не все подтвердили готовность.
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

  await gameData.embedMessage.edit({ embeds: [embed], components: [] });
}
module.exports.returnToWaitingStage = returnToWaitingStage;

/**
 * Начинаем стадию "драфта" капитанов.
 */
async function startDraftPhase(gameData, client) {
  gameData.gameStage = 'draft';
  gameData.draftTurns = 0;

  // Если не выбраны капитаны, выбираем случайно
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

  // Если свободных игроков меньше 2, сразу переходим к стадиям (у нас draft быстро закончится)
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

  const team1Members = await Promise.all(
    gameData.team1.map(async pid => (await guild.members.fetch(pid)).user.username)
  );
  const team2Members = await Promise.all(
    gameData.team2.map(async pid => (await guild.members.fetch(pid)).user.username)
  );

  const embed = new EmbedBuilder()
    .setTitle(`Матч #${gameData.gameId} — Драфт игроков`)
    .setDescription(
      `Команда капитана <@${gameData.captain1}>: ${team1Members.join(', ') || '_нет_'}\n` +
      `Команда капитана <@${gameData.captain2}>: ${team2Members.join(', ') || '_нет_'}\n\n` +
      `Свободные игроки:\n`
    )
    .setColor('Blue');

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

  await gameData.embedMessage.edit({ embeds: [embed], components: rows });
}
module.exports.startDraftPhase = startDraftPhase;

/**
 * Обработка интеракции при драфте (капитан выбирает игрока).
 */
async function handlePickInteraction(interaction, gameId, pickPlayerId) {
  const gameData = activeGames.get(gameId);
  if (!gameData || gameData.gameStage !== 'draft') {
    return interaction.reply({ content: 'Сейчас не стадия драфта!', ephemeral: true });
  }

  const isC1Turn = (gameData.draftTurns % 2 === 0);
  const currentCaptain = isC1Turn ? gameData.captain1 : gameData.captain2;

  if (interaction.user.id !== currentCaptain) {
    return interaction.reply({ content: 'Сейчас ход другого капитана!', ephemeral: true });
  }

  const idx = gameData.restPlayers.indexOf(pickPlayerId);
  if (idx === -1) {
    return interaction.reply({ content: 'Этот игрок уже выбран!', ephemeral: true });
  }

  // Перекладываем игрока в команду капитана
  gameData.restPlayers.splice(idx, 1);
  if (isC1Turn) gameData.team1.push(pickPlayerId);
  else gameData.team2.push(pickPlayerId);
  gameData.draftTurns++;

  await updateMatchInDB(gameData.gameId, {
    team1: gameData.team1,
    team2: gameData.team2,
    restPlayers: gameData.restPlayers,
    draftTurns: gameData.draftTurns
  });

  // Обновляем кнопки, чтобы выбрать уже нельзя было
  const oldRows = interaction.message.components;
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
      // Если игрока больше нет среди restPlayers, делаем кнопку неактивной
      if (!gameData.restPlayers.includes(pId)) {
        btn.setDisabled(true);
      }
      row2.addComponents(btn);
    }
    newRows.push(row2);
  }
  await interaction.update({ components: newRows });

  // Если остался один или ноль свободных, завершаем драфт
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
    await startVetoPhase(gameData, interaction.client);
    return;
  } else if (gameData.restPlayers.length === 0) {
    await startVetoPhase(gameData, interaction.client);
    return;
  }

  // Иначе просто обновляем описание драфта
  const guild = await interaction.guild;
  const team1Members = await Promise.all(gameData.team1.map(async pid => {
    const member = await guild.members.fetch(pid);
    return member.user.username;
  }));
  const team2Members = await Promise.all(gameData.team2.map(async pid => {
    const member = await guild.members.fetch(pid);
    return member.user.username;
  }));

  const embed = EmbedBuilder.from(gameData.embedMessage.embeds[0])
    .setDescription(
      `Команда капитана <@${gameData.captain1}>: ${team1Members.join(', ') || '_нет_'}\n` +
      `Команда капитана <@${gameData.captain2}>: ${team2Members.join(', ') || '_нет_'}\n\n` +
      `Осталось свободных игроков: **${gameData.restPlayers.length}**`
    );
  await gameData.embedMessage.edit({ embeds: [embed], components: newRows });
}
module.exports.handlePickInteraction = handlePickInteraction;

/**
 * Начинаем этап вето карт.
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

  const embed = new EmbedBuilder()
    .setTitle(`Матч #${gameData.gameId} — Вето карт`)
    .setDescription(
      `Капитаны:\n- <@${gameData.captain1}>\n- <@${gameData.captain2}>\n` +
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

  await gameData.embedMessage.edit({ embeds: [embed], components: rows });
}
module.exports.startVetoPhase = startVetoPhase;

/**
 * Обработка вето (убирания) карты капитанами.
 */
async function handleVetoInteraction(interaction, gameId, mapName) {
  const gameData = activeGames.get(gameId);
  if (!gameData || gameData.gameStage !== 'veto') {
    return interaction.reply({ content: 'Сейчас не стадия вето!', ephemeral: true });
  }

  const isC1Turn = (gameData.vetoTurns % 2 === 0);
  const currentCaptain = isC1Turn ? gameData.captain1 : gameData.captain2;
  if (interaction.user.id !== currentCaptain) {
    return interaction.reply({ content: 'Сейчас ход другого капитана!', ephemeral: true });
  }

  gameData.removedMaps.add(mapName);
  gameData.vetoTurns++;

  await updateMatchInDB(gameData.gameId, {
    removedMaps: Array.from(gameData.removedMaps),
    vetoTurns: gameData.vetoTurns
  });

  // Обновляем кнопки
  const oldRows = interaction.message.components;
  const newRows = [];
  for (const row of oldRows) {
    const row2 = new ActionRowBuilder();
    for (const c of row.components) {
      const btn = ButtonBuilder.from(c);
      const id = btn.data?.custom_id;
      if (!id) continue;
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

  // Сколько карт осталось?
  const mapsLeft = MAPS.map(m => m.name).filter(name => !gameData.removedMaps.has(name));
  if (mapsLeft.length > 1) {
    await interaction.update({ components: newRows });
  } else {
    const selectedMapName = mapsLeft[0];
    const selectedMap = MAPS.find(m => m.name === selectedMapName);
    gameData.finalMap = selectedMap ? selectedMap.code : selectedMapName;

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
        if (thisMap === gameData.finalMap) {
          btn.setStyle(ButtonStyle.Success);
        }
        btn.setDisabled(true);
        row2.addComponents(btn);
      }
      finalRows.push(row2);
    }
    await interaction.update({ components: finalRows });

    await updateMatchInDB(gameData.gameId, {
      finalMap: gameData.finalMap
    });

    // Переходим к финализации команд (и запуску сервера CS2)
    await finalizeTeams(gameData, interaction.client);
  }
}
module.exports.handleVetoInteraction = handleVetoInteraction;

/**
 * Завершаем формирование команд. 
 * Создаём для них каналы, двигаем игроков, удаляем embed и запускаем сервер CS2 через createMatchOnServer.
 */
async function finalizeTeams(gameData, client) {
  gameData.gameStage = 'teams_done';

  const guild = await client.guilds.fetch(gameData.guildId);
  const lobby = guild.channels.cache.get(gameData.lobbyId);

  // Удаляем старые каналы команд, если они существуют
  if (gameData.team1ChannelId) {
    const ch1 = guild.channels.cache.get(gameData.team1ChannelId);
    if (ch1) await ch1.delete().catch(() => { });
  }
  if (gameData.team2ChannelId) {
    const ch2 = guild.channels.cache.get(gameData.team2ChannelId);
    if (ch2) await ch2.delete().catch(() => { });
  }

  // Определяем категорию для создания новых каналов
  let category = lobby?.parent ?? null;
  if (!category || category.type !== ChannelType.GuildCategory) {
    category = await guild.channels.create({
      name: 'GAME_LOBBY',
      type: ChannelType.GuildCategory
    });
  }

  // Создаем новые голосовые каналы для команд
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

  try {
    await gameData.embedMessage?.delete();
  } catch (err) {
    console.error('Не удалось удалить embed:', err);
  }

  let matchInfo;
  try {
    matchInfo = await createMatchOnServer({
      gameId: gameData.gameId,
      finalMap: gameData.finalMap,
      players: Array.from(gameData.players),
      configUrl: gameData.configUrl,
      authToken: gameData.authToken,
      configFile: 'server.json',
      playersPerTeam: Array.from(gameData.players).length / 2,
      maxRounds: 24,
      maxOvertimeRounds: 6,
      teamMode: 0
    });
    console.log(`Матч #${gameData.gameId} успешно запущен на CS2-сервере.`);
  } catch (error) {
    console.error(`Не удалось запустить матч #${gameData.gameId} на CS2-сервере:`, error);
  }

  if (matchInfo) {
    for (const pid of gameData.players) {
      try {
        const user = await client.users.fetch(pid);
        if (user) {
          const connectEmbed = new EmbedBuilder()
            .setTitle("Подключитесь к матчу!")
            .setDescription(`Введите команду: \`connect ${matchInfo.host}:${matchInfo.port}\``)
            .setColor("Green")
            .setFooter({ text: "Удачи в игре!" });
          await user.send({ embeds: [connectEmbed] });
        }
      } catch (err) {
        console.error(`Не удалось отправить сообщение пользователю ${pid}:`, err);
      }
    }
  }

  activeGames.delete(gameData.gameId);

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

async function updateMatchInDB(gameId, updateObj) {
  // Преобразуем Set в массивы
  for (const key of Object.keys(updateObj)) {
    if (updateObj[key] instanceof Set) {
      updateObj[key] = Array.from(updateObj[key]);
    }
  }

  await Match.findOneAndUpdate({ gameId }, { $set: updateObj }).catch(err => {
    console.error(`Не удалось обновить Match (gameId=${gameId}):`, err);
  });
}

/**
 * Утилита для создания строк кнопок (ActionRowBuilder),
 * делит кнопки на ряды по perRow штук.
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
 * Перемешивает массив (алгоритм Фишера–Йейтса).
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
