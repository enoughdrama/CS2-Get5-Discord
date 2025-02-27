const User = require('../models/user');

async function getSteamLink(userId) {
    const user = await User.findOne({ userId });
    return user ? user.steamId : null;
}

async function setSteamLink(userId, steamId) {
    const user = await User.findOneAndUpdate(
        { userId },
        { steamId, linkedAt: new Date() },
        { new: true, upsert: true }
    );
    return user;
}

async function removeSteamLink(userId) {
    await User.findOneAndDelete({ userId });
}

module.exports = {
    getSteamLink,
    setSteamLink,
    removeSteamLink
};
