const child = require('child_process');
const fs = require('fs');
const util = require('util');

const firebase = require('firebase-admin');
const mongoose = require('mongoose');

// Config
const config = require('./config');

if (config.hostJob.processor) {
  const serviceAccountCredentials = require('./firebase.config');
  firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccountCredentials),
    databaseURL: config.firebaseUrl
  });
}

const utils = {};

utils.processMeta = async function processMeta(id, data) {
  let detections = {};

  if (!data) {
    try {
      data = fs.readFileSync(`${__dirname}/data/vids/${id}.meta`);
      data = JSON.parse(data.toString());
    } catch(e) {
      return {
        detections: [],
        length: '0',
        camera: 'Unknown'
      }
    }
  }

  for(let timestamp of Object.keys(data.detections)) {
    for (let detection of data.detections[timestamp]) {
      if (!detections[detection.class]) {
        detections[detection.class] = {
          highestScore: detection.score,
          count: 1
        };
      } else {
        if (detections[detection.class].highestScore < detection.score) {
          detections[detection.class].highestScore = detection.score;
        }
        detections[detection.class].count++;
      }
    }
  }

  detections = Object.keys(detections).map((classification) => {
    return {
      classification: classification,
      highestScore: detections[classification].highestScore,
      count: detections[classification].count
    }
  }).sort((a, b) => {
    return b.count - a.count;
  });

  return {
    detections,
    length: data.length,
    camera: data.camera
  };
};

utils.sendNotifications = async function(recording) {
  console.log('Sending notifications for', recording.id, recording.detections[0].classification);
  let tokens = await mongoose.model('NotificationToken').find({ enabled: true });

  if (!tokens || !tokens.length) {
    return console.log('No device tokens found, unable to send notification');
  }

  let recordingObject = recording.externalObject();

  for (let token of tokens) {
    let message = {
      notification: {
        title: 'New Security Event',
        body: 'Detected: ' + recordingObject.detections[0].classification
      },
      data: {
        payload: JSON.stringify(recordingObject)
      },
      android: {
        priority: 'high',
        notification: {
          click_action: '.VideoPlayerActivity'
        }
      },
      token: token.token
    };
    // console.log(message);
    await firebase.messaging().send(message);
  }
};

utils.transcodeVideo = async function(recordingId, fileBuffer) {
  return new Promise(resolve => {
    let ffmpeg = child.spawn('ffmpeg', ['-y', '-i', '-', '-c:v', 'libx264', `${config.recordings.processedOutputPath}/${recordingId}.mp4`]);
    ffmpeg.stdin.write(fileBuffer);
    ffmpeg.stdin.end();
    ffmpeg.stdout.on('end', resolve);
  });
};

utils.fetchVideoFrameCount = async function(recordingId) {
  return new Promise((resolve, reject) => {
    let command = `ffprobe -v error -select_streams v:0 -show_entries stream=nb_frames -of default=nokey=1:noprint_wrappers=1` +
      ` ${config.recordings.processedOutputPath}/${recordingId}.mp4`;
    child.exec(command, (err, frameCount) => {
      if (err) {
        console.log('Error getting frame count', err);
        return reject(err);
      }
      frameCount = parseInt(frameCount);
      resolve(frameCount);
    });
  });
};

utils.generateThumbnail = async function(recordingId, frameCount) {
  if (!frameCount) {
    frameCount = await utils.fetchVideoFrameCount(recordingId);
  }

  frameCount = frameCount + (frameCount % 2);
  let middleFrame = frameCount / 2;
  let args = [
    '-i',
    `${config.recordings.processedOutputPath}/${recordingId}.mp4`,
    '-f',
    'mjpeg',
    '-vf',
    `select=gte(n\\,${middleFrame}),scale=1080:-1`,
    '-vframes',
    '1',
    '-'
    // `${config.recordings.processedOutputPath}/${recordingId}.jpg`
  ];

  let buffer = Buffer.from('');
  return new Promise(resolve => {
    let thumbGnerator = child.spawn('ffmpeg', args);
    thumbGnerator.stdout.on('data', buf => {
      buffer = Buffer.concat([buffer, buf]);
    });
    thumbGnerator.on('close', () => {
      resolve(buffer);
    });
  });
};

utils.getRecordingMiddleware = function getRecording(projection) {
  return async function(req, res, next) {
    let recording;

    if (typeof req.params.id !== 'string') {
      return res.status(400).send({ error: 'Invalid ID' });
    }

    let query = mongoose.model('Recording').findOne({ _id: req.params.id });

    if (projection) {
      query.select(projection);
    }

    try {
      recording = await query;
    } catch (e) {
      return res.status(500).send({ error: 'Error finding recording' });
    }

    if (!recording) {
      return res.status(404).send({ error: 'Not found' });
    }

    req.recording = recording;
    next();
  };
};

utils.fsWriteAsync = util.promisify(fs.writeFile);
utils.fsReadAsync = util.promisify(fs.readFile);
utils.fsStatAsync = util.promisify(fs.stat);
utils.fsExistsAsync = util.promisify(fs.exists);

module.exports = utils;
