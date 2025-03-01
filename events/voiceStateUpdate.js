const { manageLobbyJoinLeave } = require('../utils/gameManager');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState, client) {
    try {
      await manageLobbyJoinLeave(oldState, newState, client);
    } catch (error) {
      console.error('Ошибка в voiceStateUpdate:', error);
    }
  },
};
