const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');

const EC = require('elliptic').ec;
const ec = new EC('p256');
const mongoose = require('mongoose');

const config = require('./config');

const Authentication = {
  lastRequestNonce: {},
  counter: 0
};

function generateAuthError(message) {
  let err;
  if (message instanceof Error) {
    err = message;
  } else {
    err = new Error(message);
  }
  err.status = 401;
  return err;
}

Authentication.requireLocalhostMiddleware = function(req, res, next) {
  if (!['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(req.connection.remoteAddress)) {
    console.log('Rejected localhost', req.connection.remoteAddress);
    return next(generateAuthError('This IP address is not authorized to make this request'));
  }
  next();
};

Authentication.verifySignatureMiddleware = function(accessLevel) {
  return async function(req, res, next) {
    try {
      // Check basic validity
      assert.strictEqual(typeof req.headers['x-identity'], 'string', 'x-identity header missing or invalid');
      assert.strictEqual(typeof req.headers['x-signature'], 'string', 'x-signature header missing or invalid');
      assert.strictEqual(typeof req.headers['x-time'], 'string', 'x-time header missing or invalid');
    } catch (e) {
      return next(generateAuthError(e));
    }

    let publicKey = req.headers['x-identity'];
    let signature = req.headers['x-signature'];
    let oneTimeAuth = req.headers['x-oneTimeAuth'];
    let url = config.hostname + req.originalUrl;
    let payload;

    try {
      await mongoose.model('AuthorizedKey').checkAccess(publicKey, accessLevel);
    } catch(e) {
      return next(generateAuthError(e));
    }

    // Remove trailing slash
    if (url[url.length - 1] === '/') {
      url = url.substr(0, url.length - 1);
    }

    if (oneTimeAuth) {
      try {
        // Verify OTA token
        assert.strictEqual(typeof req.headers['x-oneTimeAuth'], 'string', 'x-oneTimeAuth header invalid');
        let ota = await mongoose.model('OneTimeAuth').findAndBurn(oneTimeAuth);
        if (ota.pathRestriction) {
          if (req.originalUrl.indexOf(ota.pathRestriction) !== 0) {
            console.error('restriction reject', req.originalUrl, ota.pathRestriction);
            // noinspection ExceptionCaughtLocallyJS
            throw new Error(`This OTA token was restricted to the path ${ota.pathRestriction}`);
          }
        }
      } catch (e) {
        return next(generateAuthError(e));
      }
      payload = req.headers['x-time'] + url + oneTimeAuth;
    } else {
      payload = req.headers['x-time'] + url + (req.rawBody || 'null').toString();
    }

    if (Authentication.lastRequestNonce[publicKey] && Authentication.lastRequestNonce[publicKey] >= parseInt(req.headers['x-time'])) {
      return next(generateAuthError('Invalid or repeat nonce'));
    }

    if (!Authentication.verifySignature(publicKey, signature, payload)) {
      return next(generateAuthError('Invalid signature'));
    }

    // TODO put this on the model
    Authentication.lastRequestNonce[publicKey] = parseInt(req.headers['x-time']);
    return next();
  };
};

Authentication.verifySignature = function(publicKey, signature, payload) {
  let keyInstance;
  try {
    keyInstance = ec.keyFromPublic(publicKey, 'hex');
  } catch (e) {
    return false;
  }
  let hash = crypto.createHash('sha256').update(payload).digest('hex');
  return keyInstance.verify(hash, signature);
};

Authentication.generateHeaders = async function(url, body, oneTimeAuth) {
  if (!Authentication.privateKeyPair) {
    await loadPrivateKey()
  }

  let publicKey = Authentication.privateKeyPair.getPublic('hex');
  let now = Date.now();

  if (!Authentication.lastRequestNonce[publicKey] || Authentication.lastRequestNonce[publicKey] < now) {
    Authentication.lastRequestNonce[publicKey] = now;
    Authentication.counter = 0;
  }

  let time = `${now}${Authentication.counter++}`;

  let headers = {
    'x-time': time,
    'x-identity': publicKey,
    'x-signature': Authentication.privateKeyPair.sign(`${time}${url}${body}`)
  };

  if (oneTimeAuth) {
    headers['x-oneTimeAuth'] = body;
  }

  return headers;
};

async function loadPrivateKey() {
  if (!await utils.fsExistsAsync('./state/private.key')) {
    Authentication.privateKeyPair = ec.genKeyPair();
    await utils.fsWriteAsync('./state/private.key', Authentication.privateKeyPair.getPrivate('hex'), { encoding: 'hex' });
  } else {
    let privateKey = await utils.fsReadAsync('./state/private.key').toString('hex');
    Authentication.privateKeyPair = ec.keyFromPrivate(privateKey, 'hex');
  }
}

module.exports = Authentication;
