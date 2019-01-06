const mongoose = require('mongoose');

const AuthorizedKeySchema = new mongoose.Schema({
  publicKey: {
    type: String,
    unique: true,
    validate: /^04[a-f\d]{128}$/
  },
  access: [{
    type: String,
    enum: ['read', 'write']
  }]
});

AuthorizedKeySchema.statics.grantAccess = async function(publicKey, access) {
  let key = await this.findOne({ publicKey: publicKey });
  if (!key) {
    key = new mongoose.model('AuthorizedKey')({
      publicKey: publicKey,
    });
  }
  if (typeof access === 'string') {
    access = [access];
  }
  access.forEach((accessLevel) => {
    key.access.addToSet(accessLevel);
  });
  return key.save();
};

AuthorizedKeySchema.statics.checkAccess = async function(publicKey, accessLevel) {
  let key = await this.findOne({ publicKey: publicKey });
  if (!key || !key.access.includes(accessLevel)) {
    throw new Error('Unauthorized Key');
  }
};

module.exports = mongoose.model('AuthorizedKey', AuthorizedKeySchema);
