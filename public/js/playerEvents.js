function PlayerEvents(){}

PlayerEvents.prototype.events = {};

PlayerEvents.prototype.on = function (event, listener) {
  if (typeof this.events[event] !== 'object') {
    this.events[event] = []
  }

  this.events[event].push(listener)
};

PlayerEvents.prototype.removeListener = function (event, listener) {
  let idx;

  if (typeof this.events[event] === 'object') {
    idx = this.events[event].indexOf(listener);

    if (idx > -1) {
      this.events[event].splice(idx, 1)
    }
  }
};

PlayerEvents.prototype.emit = function (event) {
  var i, listeners, length, args = [].slice.call(arguments, 1);

  if (typeof this.events[event] === 'object') {
    listeners = this.events[event].slice();
    length = listeners.length;

    for (i = 0; i < length; i++) {
      listeners[i].apply(this, args)
    }
  }
};

PlayerEvents.prototype.once = function (event, listener) {
  this.on(event, function g () {
    this.removeListener(event, g);
    listener.apply(this, arguments)
  })
};

PlayerEvents.prototype.videoReady = function() {
  this.emit('videoReady');
};

PlayerEvents.prototype.waitForVideoReady = async function() {
  return new Promise((resolve) => {
    this.once('videoReady', resolve);
  });
};
