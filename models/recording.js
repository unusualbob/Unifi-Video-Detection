const fs = require('fs');
const path = require('path');

const mongoose = require('mongoose');
const opn = require('opn');

const authentication = require('../authentication');
const config = require('../config');
const messenger = require('../messenger');
const utils = require('../utils');

const twelveHours = 12 * 60 * 60 * 1000;

const RecordingSchema = new mongoose.Schema({
  _unifiRecordingId: { type: mongoose.Schema.Types.ObjectId, unique: true },
  status: {
    objectDetection: {
      type: String,
      enum: ['pending', 'processing', 'complete'],
      default: 'pending'
    },
    faceDetection: {
      type: String,
      enum: ['blocked', 'pending', 'processing', 'complete', 'skipped'],
      default: 'blocked'
    },
    remoteUpload: {
      type: String,
      enum: ['blocked', 'pending', 'processing', 'complete', 'skipped'],
      default: 'blocked'
    },
    taskStart: Date
  },
  camera: String,
  recordingLength: Number,
  objectDetected: { type: Boolean, default: false },
  personDetected: { type: Boolean, default: false },
  faceDetected: { type: Boolean, default: false },
  thumbnail: { type: String, select: false },
  detections: [{
    _id:false,
    classification: String,
    highestScore: Number,
    count: Number
  }],
  rawDetections: [{
    _id:false,
    classification: String,
    score: Number
  }]
});

RecordingSchema.statics.createUnique = async function(recordingId) {
  let recording = await mongoose.model('Recording').findOne({ _unifiRecordingId: recordingId });
  if (!recording) {
    recording = new mongoose.model('Recording')({
      _unifiRecordingId: recordingId
    });
    await recording.save();
  }
};

/**
 * Queues existing recording for processing
 * @param recordingId
 * @return {Promise<void>}
 */
RecordingSchema.statics.reQueue = async function(recordingId) {
  let recording = await mongoose.model('Recording').findOne({ _id: recordingId });
  if (recording) {
    if (recording.status.objectDetection !== 'pending') {
      recording.status.objectDetection = 'pending';
    }
  } else {
    throw new Error('Recording not found');
  }
  await recording.save();
};

/**
 * Queues recording for processsing, or creates recording if it doesn't exist
 * @param unifiRecordingId
 * @return {Promise<void>}
 */
RecordingSchema.statics.createOrReQueue = async function(unifiRecordingId) {
  let recording = await mongoose.model('Recording').findOne({ _unifiRecordingId: unifiRecordingId });
  if (!recording) {
    recording = await utils.unifi.getRecording(unifiRecordingId);
    console.log('creating recording');
    recording = new mongoose.model('Recording')({
      _unifiRecordingId: unifiRecordingId
    });
  } else {
    if (recording.status.objectDetection !== 'pending') {
      recording.status.objectDetection = 'pending';
    }
  }
  await recording.save();
};

RecordingSchema.statics.getRecentDetections = async function(skipToId) {
  let query = {
    objectDetected: true
  };
  if (skipToId) {
    query._unifiRecordingId = {
      $lt: skipToId
    };
  }
  return await mongoose.model('Recording').find(query).select({
    _unifiRecordingId: 1,
    camera: 1,
    recordingLength: 1,
    detections: 1
  }).sort({_unifiRecordingId: -1}).limit(50);
};

RecordingSchema.methods.externalObject = function() {
  let object = this.toObject();
  return {
    id: object._id.toString(),
    camera: object.camera || 'Unknown',
    detections: object.detections,
    length: object.recordingLength,
    time: object._unifiRecordingId.getTimestamp().toISOString()
  };
};

RecordingSchema.methods.markClear = async function() {
  if (this.status.objectDetection === 'processing') {
    this.status.objectDetection = 'complete';
    this.status.faceDetection = 'skipped';
  } else {
    throw new Error(`Video not processing, cannot clear, status is ${this.status.objectDetection}`);
  }
  console.log(`No object detections ${this._id}`);
  messenger.emit(this._id.toString());
  await this.save();
};

RecordingSchema.methods.markFailed = async function() {
  if (this.status.objectDetection === 'processing') {
    this.status.objectDetection = 'pending';
  } else {
    throw new Error(`Video not processing, cannot fail, status is ${this.status.objectDetection}`);
  }

  console.log(`Failed to process recording ${this._id}`);
  messenger.emit(this._id.toString());
  await this.save();
};

RecordingSchema.methods.streamRaw = async function() {
  try {
    return utils.unifi.streamRecording(this._unifiRecordingId);
  } catch(e) {
    console.log(e);
    return res.status(500).send({error: e.message});
  }
};

RecordingSchema.methods.storeProcessed = async function(fileBuffer, detections) {
  this.status.objectDetection = 'complete';

  await utils.transcodeVideo(this._id.toString(), fileBuffer);

  let frameCount = await utils.fetchVideoFrameCount(this._id.toString());
  this.recordingLength = (frameCount / 30).toFixed(1);

  await this.generateThumbnail(frameCount);
  await this.processMeta(detections);

  console.log(`Object detections processed ${this._id}`);
  messenger.emit(this._id.toString());

  // If this worker is only the processor, upload to file host
  if (!config.hostJob.fileHost) {
    this.status.remoteUpload = 'pending';
    await this.save();
    let token = await this.createRemoteRecording();
    await this.uploadToRemoteHost(token);
  }

  // Only send if recent event
  if (this._unifiRecordingId.getTimestamp().getTime() > Date.now() - twelveHours) {
    await utils.sendNotifications(this);
  }
};

RecordingSchema.methods.storeProcessedViaUpload = async function(fileBuffer) {
  let filePath = path.resolve(config.recordings.processedOutputPath, `${this.id}.mp4`);

  if (await utils.fsExistsAsync(filePath)) {
    let stat = await utils.fsStatAsync(filePath);
    if (stat.size > fileBuffer.byteLength) {
      // Ignore existing larger file
      return;
    } else if (stat.size === fileBuffer.byteLength) {
      // Ignore existing identical file
      return;
    } else {
      // Check smaller existing file to see if its a subset of a failed complete upload
      let existingData = await utils.fsReadAsync(filePath);
      let eightyPercentLength = parseInt(existingData.byteLength * 0.8);
      let subset = Buffer.compare(fileBuffer.slice(0, eightyPercentLength), existingData.slice(0, eightyPercentLength));
      if (!subset) {
        // If file isn't a subset that means new file is a different upload, possibly malicious overwrite, bail out
        console.error('Aborting upload due to file mismatch', this.id);
        throw new Error('Upload attempted of different file than currently exists');
      }
    }
  }
  await utils.fsWriteAsync(filePath, fileBuffer);
};

RecordingSchema.methods.streamProcessed = async function() {
  return fs.createReadStream(`${config.recordings.processedOutputPath}/${this._id.toString()}.mp4`);
};

RecordingSchema.methods.createRemoteRecording = async function() {
  let url = `${config.fileHostUrl}/recordings/create`;
  let jsonBody = JSON.stringify(this.toObject());
  let headers = await authentication.generateHeaders(url, jsonBody);

  let [response, body] = await utils.makeRequest({
    url: url,
    json: true,
    body: this.toObject(),
    headers: headers,
    method: 'POST'
  });

  if (response.statusCode !== 200) {
    console.error('Create remote recording failed', response.statusCode);
    console.error(body);
    throw new Error('Failed create on remote host');
  }

  return body.authToken;
};

RecordingSchema.methods.uploadToRemoteHost = async function(oneTimeAuthToken) {
  let url = `${config.fileHostUrl}/recordings/${this.id}/upload`;
  let headers = await authentication.generateHeaders(url, oneTimeAuthToken, true);

  let [response, body] = await utils.makeRequest({
    url: url,
    headers: headers,
    formData: {
      video: fs.createReadStream(path.resolve(config.recordings.processedOutputPath, `${this.id}.mp4`))
    },
    method: 'POST'
  });

  if (response.statusCode !== 200) {
    console.error('Upload remote recording failed', response.statusCode);
    console.error(body);
  }

  console.log(body);
};

RecordingSchema.methods.runObjectDetection = async function() {
  this.status.objectDetection = 'processing';
  this.status.taskStart = Date.now();
  await this.save();
  console.log('Running object detection on', this._id);
  opn(`http://localhost:3000/recordings/process/${this._id}`, {app: 'google-chrome'});
  return await messenger.subscribe(this._id.toString());
};

RecordingSchema.methods.processMeta = async function(detections) {
  let rawDetections = [];
  for(let timestamp of Object.keys(detections)) {
    for (let detection of detections[timestamp]) {
      rawDetections.push({
        score: detection.score,
        classification: detection.class
      });
    }
  }
  this.objectDetected = !!rawDetections.length;
  this.rawDetections = rawDetections;
  this.recalculateDetections();
  await this.save();
};

RecordingSchema.methods.recalculateDetections = function() {
  let detections = {};
  for (let detection of this.rawDetections) {
    if (!detections[detection.classification]) {
      detections[detection.classification] = {
        highestScore: detection.score,
        count: 1
      };
    } else {
      if (detections[detection.classification].highestScore < detection.score) {
        detections[detection.classification].highestScore = detection.score;
      }
      detections[detection.classification].count++;
    }
  }

  this.detections = Object.keys(detections).map((classification) => {
    return {
      classification: classification,
      highestScore: detections[classification].highestScore,
      count: detections[classification].count
    }
  }).sort((a, b) => {
    return b.count - a.count;
  });
  this.personDetected = !!detections.person;
};

RecordingSchema.methods.generateThumbnail = async function(frameCount) {
  let imageBuffer = await utils.generateThumbnail(this._id.toString(), frameCount);
  this.thumbnail = imageBuffer.toString('base64');
  await this.save();
};

module.exports = mongoose.model('Recording', RecordingSchema);
