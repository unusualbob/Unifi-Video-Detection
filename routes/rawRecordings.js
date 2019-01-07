const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');

const router = express.Router();
const upload = multer({ storage:  multer.memoryStorage() });

const authentication = require('../authentication');
const utils = require('../utils');

router.get('/:id/notify', authentication.requireLocalhostMiddleware, utils.getRecordingMiddleware(), async (req, res) => {
  await utils.sendNotifications(req.recording);
  res.send({ status: 'Success' });
});

router.get('/process/:id', authentication.requireLocalhostMiddleware, (req, res) => {
  res.render('processVideo', {videoId: req.params.id});
});

router.get('/raw/:id', authentication.requireLocalhostMiddleware, utils.getRecordingMiddleware(), async (req, res) => {
  let stream = await req.recording.streamRaw();
  return stream.pipe(res);
});

router.post('/processed/:id', authentication.requireLocalhostMiddleware, utils.getRecordingMiddleware(), upload.single('video'), async (req, res) => {
  let detections;
  if (req.file.buffer.slice(0, 4).compare(Buffer.from('1A45DFA3', 'hex')) !== 0) {
    return res.status(400).send({
      error: 'File must be a webm'
    });
  }

  try {
    detections = JSON.parse(req.body.detect)
  } catch(e) {
    return res.status(400).send({error: e.message});
  }

  // console.log(detections);

  await req.recording.storeProcessed(req.file.buffer, detections);
  res.sendStatus(200);
});

router.post('/:id/clear', authentication.requireLocalhostMiddleware, utils.getRecordingMiddleware(), async (req, res) => {
  try {
    await req.recording.markClear();
  } catch(e) {
    console.log(e);
    return res.status(500).send({error: e});
  }
  res.sendStatus(200);
});

router.post('/:id/failed', authentication.requireLocalhostMiddleware, utils.getRecordingMiddleware(), async (req, res) => {
  try {
    await req.recording.markFailed();
  } catch(e) {
    console.log(e);
    return res.status(500).send({error: e});
  }
  res.sendStatus(200);
});

router.get('/request/:id', authentication.requireLocalhostMiddleware, async (req, res) => {
  try {
    await mongoose.model('Recording').createOrReQueue(req.params.id);
  } catch(e) {
    return res.status(400).send({ error: e.message });
  }
  return res.send({ status: 'Success' });
});

router.get('/requeue/:id', authentication.requireLocalhostMiddleware, async (req, res) => {
  try {
    await mongoose.model('Recording').reQueue(req.params.id);
  } catch(e) {
    return res.status(400).send({ error: e.message });
  }
  return res.send({ status: 'Success' });
});

module.exports = router;
