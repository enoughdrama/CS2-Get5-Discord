const mongoose = require('mongoose');

/**
 * Полная схема, отражающая состояние матча.
 * При необходимости можно расширить или убрать некоторые поля.
 */
const matchSchema = new mongoose.Schema({
  gameId:          { type: String, required: true },
  guildId:         { type: String, required: true },
  lobbyId:         { type: String, default: null },
  queueChannelId:  { type: String, default: null },
  requiredPlayers: { type: Number, default: 10 },

  gameStage:       { type: String, default: 'waiting' }, // waiting, readyCheck, draft, veto, teams_done, ...

  players:         { type: [String], default: [] },
  readyPlayers:    { type: [String], default: [] },
  restPlayers:     { type: [String], default: [] },

  captain1:        { type: String, default: null },
  captain2:        { type: String, default: null },
  team1:           { type: [String], default: [] },
  team2:           { type: [String], default: [] },

  removedMaps:     { type: [String], default: [] },
  finalMap:        { type: String, default: null },
  vetoTurns:       { type: Number, default: 0 },
  draftTurns:      { type: Number, default: 0 },

  team1ChannelId:  { type: String, default: null },
  team2ChannelId:  { type: String, default: null },

  embedMessageId:  { type: String, default: null },

  date:            { type: Date, default: Date.now }
});

module.exports = mongoose.model('Match', matchSchema);