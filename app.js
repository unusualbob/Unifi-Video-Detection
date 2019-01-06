// Native
const path = require('path');

// Modules
const express = require('express');

// database
require('./db');

// routes
const recordings = require('./routes/recordings');
const rawRecordings = require('./routes/rawRecordings');

// misc
const config = require('./config');
const utils = require('./utils');
const Unifi = require('./unifi');
const Scheduler = require('./scheduler');

// Instances
const app = express();
const unifi = new Unifi();
const scheduler = new Scheduler();

// Init
utils.scheduler = scheduler;
utils.unifi = unifi;

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// Store raw body for json requests for signature verification
app.use(express.json({
  limit: '300kb',
  verify: function(req, res, buf) {
    if (buf) {
      req.rawBody = buf.toString();
    }
  }
}));

// Routes
if (config.hostJob.fileHost) {
  app.use('/recordings', recordings);
}
if (config.hostJob.processor) {
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/recordings', rawRecordings);
}

// error handler
app.use(function(err, req, res) {
  console.log('err handler', err.message);
  res.status(err.status || 500).send({error: err.message});
});

// catch 404 and forward to error handler
app.use(function(req, res) {
  res.status(404).send('Page not found');
});


process.on('uncaughtException', (err) => {
  console.log('Uncaught', err);
  console.trace();
});

if (config.hostJob.processor) {
  scheduler.start();
}

module.exports = app;
