const mongoose = require('mongoose');

const NotificationTokenSchema = new mongoose.Schema({
  token: { type: String, unique: true },
  enabled: { type: Boolean, default: true },
  label: String
});

module.exports = mongoose.model('NotificationToken', NotificationTokenSchema);
