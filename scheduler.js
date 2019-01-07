const ObjectId = require('bson').ObjectID;
const mongoose = require('mongoose');

const utils = require('./utils');

function Scheduler() {}

Scheduler.prototype.start = async function start() {
  console.log('Start');
  await utils.unifi.authenticate();
  await this.checkForStuckRecordings();
  this.runObjectDetection();
  this.getLatestRecordings();
};

Scheduler.prototype.runObjectDetection = async function() {
  let recordings;

  console.log('Process pending recordings...');
  try {
    recordings = await mongoose.model('Recording').find({
      'status.objectDetection': 'pending'
    }).sort({ _id: 1 }).limit(1);
  } catch(e) {
    console.error('error finding recordings', e);
  }

  if (recordings && recordings.length) {
    await recordings[0].runObjectDetection();
    process.nextTick(() => { this.runObjectDetection(); });
  } else {
    console.log('No recordings found');
    setTimeout(() => { this.runObjectDetection(); }, 5000);
  }
};

Scheduler.prototype.checkForStuckRecordings = async function() {
  console.log('Checking for stuck jobs');
  let updated = await mongoose.model('Recording').updateMany({
    'status.objectDetection': 'processing',
    'status.taskStart': {$lte: Date.now() - 600000}
  }, {
    'status.objectDetection': 'pending'
  }).exec();
  if (updated && updated.nModified) {
    console.log(`Cleared ${updated.nModified} detection jobs`);
  }
  setTimeout(() => { this.checkForStuckRecordings(); }, 600000);
};

Scheduler.prototype.getLatestRecordings = async function() {
  let lastId = await getLastFetchedRecordingId();
  let videoIds = await utils.unifi.fetchRecordings(lastId.getTimestamp());

  console.log('Checking for new recordings, found', videoIds.length);

  for (let recordingId of videoIds) {
    let recording = await mongoose.model('Recording').findOne({ _unifiRecordingId: recordingId });
    if (!recording) {
      let recordingInfo = await utils.unifi.getRecording(recordingId);
      recording = new mongoose.model('Recording')({
        _unifiRecordingId: recordingId,
        camera: recordingInfo.camera
      });
      await recording.save();
    }
  }
  setTimeout(() => { this.getLatestRecordings(); }, 10000);
};

async function getLastFetchedRecordingId() {
  let lastId;
  let recordings = await mongoose.model('Recording').find().sort({_unifiRecordingId: -1}).limit(1);
  // if no last ID then create a fake ID from an hour ago
  if (!recordings || !recordings.length) {
    let startDate = new Date();
    startDate.setHours(startDate.getHours() - 12);
    lastId = ObjectId.createFromTime(startDate.getTime() /  1000);
  } else {
    lastId = recordings[0]._unifiRecordingId
  }
  return lastId;
}

module.exports = Scheduler;
