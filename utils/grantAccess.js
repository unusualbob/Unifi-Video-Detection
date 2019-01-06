const mongoose = require('mongoose');
require('../db');

async function grant(publicKey, accessLevel) {
  if (!publicKey || !accessLevel) {
    console.log('./grantAccess <pubkey> <accessLevel>');
    process.exit();
  }
  await mongoose.model('AuthorizedKey').grantAccess(publicKey, accessLevel);
  console.log('Added');
  mongoose.connection.close();
}

grant(process.argv[2], process.argv[3]);
