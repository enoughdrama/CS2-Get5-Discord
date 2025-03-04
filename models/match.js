const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  gameId:          { type: String, required: true },
  guildId:         { type: String, required: true },
  lobbyId:         { type: String, default: null },
  queueChannelId:  { type: String, default: null },
  requiredPlayers: { type: Number, default: 10 },

  gameStage:       { type: String, default: 'waiting' },

  players:         { type: [String], default: [] },
  readyPlayers:    { type: [String], default: [] },
  restPlayers:     { type: [String], default: [] },

  captain1:        { type: String, default: null },
  captain2:        { type: String, default: null },

  team1: { type: Map, of: String, default: {} },
  team2: { type: Map, of: String, default: {} },

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