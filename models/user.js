const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  steamId: { type: String, required: true },
  linkedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
