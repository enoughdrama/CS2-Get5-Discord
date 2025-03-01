const gamesStats = [];

function recordGameStats(gameData) {
  const now = new Date();
  const statsEntry = {
    gameId: gameData.gameId,
    guildId: gameData.guildId,
    date: now.toISOString(),
    finalMap: gameData.finalMap,
    team1: gameData.team1,
    team2: gameData.team2
  };
  gamesStats.push(statsEntry);
  console.log('Игра сохранена в статистику:', statsEntry);
}

function getAllStats() {
  return gamesStats;
}

module.exports = {
  recordGameStats,
  getAllStats
};
