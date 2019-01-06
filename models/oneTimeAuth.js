const crypto = require('crypto');
const mongoose = require('mongoose');

// One time auth tokens which are burned when used
// These are designed for cases where the body cannot reasonably be signed (like file uploads) or when a challenge-response is needed
const OneTimeAuthSchema = new mongoose.Schema({
  used: Date,
  token: {type: String, unique: true},
  pathRestriction: String
});

OneTimeAuthSchema.statics.createRestrictedToken = async function(path) {
  return new mongoose.model('OneTimeAuth')({
    token: crypto.randomBytes(48).toString('hex'),
    pathRestriction: path
  }).save();
};

OneTimeAuthSchema.statics.findAndBurn = async function(token) {
  return await this.findOneAndUpdate({
    token: token,
    used: {
      $exists: false
    }
  }, { used: Date.now() }).exec();
};

module.exports = mongoose.model('OneTimeAuth', OneTimeAuthSchema);
