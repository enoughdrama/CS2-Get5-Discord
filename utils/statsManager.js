////////////////////////////////////////////////////////////////////////////////
// ФАЙЛ: utils/statsManager.js
// Пример: храним статистику об играх в массиве (в оперативной памяти).
// В реальных проектах используйте базы данных (SQL, Mongo, и т.п.).
////////////////////////////////////////////////////////////////////////////////

const gamesStats = [];

/**
 * Сохранить данные игры в массив
 */
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

/**
 * Получить все записи статистики
 */
function getAllStats() {
  return gamesStats;
}

module.exports = {
  recordGameStats,
  getAllStats
};
