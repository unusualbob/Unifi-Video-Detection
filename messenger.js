const EventEmitter = require('events');
const util = require('util');

function Messenger() {}

util.inherits(Messenger, EventEmitter);

Messenger.prototype.subscribe = async function(eventName) {
  return new Promise(resolve => {
    this.once(eventName, resolve);
  });
};

Messenger.prototype.broadcast = function(eventName, data) {
  this.emit(eventName, data);
};

module.exports = new Messenger();
