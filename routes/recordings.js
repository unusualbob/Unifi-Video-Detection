const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');

const router = express.Router();
const upload = multer({ storage:  multer.memoryStorage() });

const authentication = require('../authentication');
const config = require('../config');
const utils = require('../utils');

router.get('/', authentication.verifySignatureMiddleware('read'), async (req, res) => {
  let recordings = await mongoose.model('Recording').getRecentDetections();
  res.send({
    securityEvents: recordings.map((recording) => {
      return recording.externalObject()
    })
  });
});

router.get('/:id', authentication.verifySignatureMiddleware('read'), utils.getRecordingMiddleware(), async (req, res) => {
  let stream = await req.recording.streamProcessed();
  return stream.pipe(res);
});

router.get('/:id/thumbnail.jpg', authentication.verifySignatureMiddleware('read'), utils.getRecordingMiddleware({thumbnail: 1}), async (req, res) => {
  res.set('Content-Type', 'image/jpeg');
  res.send(Buffer.from(req.recording.thumbnail, 'base64'));
});

// If this is only a file host and not a processor, need to allow for uploads of processed files
if (!config.hostJob.processor) {
  router.post('/create', authentication.verifySignatureMiddleware('write'), async (req, res) => {
    let recordingData = JSON.parse(req.body.recording);
    let recording = new mongoose.model('Recording')(recordingData);
    try {
      await recording.save();
    } catch(e) {
      if (e.code !== 11000) {
        throw e;
      }
    }
    let ota = await mongoose.model('OneTimeAuth').createRestrictedToken(`/recordings/${recording.id}/upload`);
    return res.status(200).send({
      authToken: ota.token
    })
  });

  router.post('/:id/upload',
    authentication.verifySignatureMiddleware('write'),
    utils.getRecordingMiddleware(),
    upload.single('video'),
    async (req, res) => {
      try {
        await req.recording.storeProcessedViaUpload(req.file.buffer);
      } catch(e) {
        return res.status(200).send({ error: e.message });
      }
      return res.sendStatus(200);
    }
  );
}

module.exports = router;
