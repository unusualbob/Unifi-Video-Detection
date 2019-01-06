const video = document.getElementById('video');

const debugTiming = false;
const debugAreas = false;
const videoSkipToStart = 3.2;

const detectionData = {};
const globals = {};

const classBlacklist = [
  'potted plant'
];

let playerEvents = new PlayerEvents();
video.addEventListener('canplay', () => {
  playerEvents.videoReady();
});

function generateCanvases() {
  let canvas = document.getElementById('canvas');
  // let canvas = document.createElement('canvas');


  globals.context = canvas.getContext('2d');
  canvas.width = globals.width;
  canvas.height = globals.height;
  globals.canvas = canvas;

  // const motionDetectionCanvas = document.getElementById('motionDetection');
  const motionDetectionCanvas = document.createElement('canvas');

  motionDetectionCanvas.width = globals.width;
  motionDetectionCanvas.height = globals.height;
  globals.motionDetectionCanvas = motionDetectionCanvas;
}

function generateZones() {
  globals.whitelistedAreas = [
    {
      name: 'sabinasCar',
      left: 0.0277,
      top: 0.125,
      width: 0.0695,
      height: 0.14583,
      classes: 'car'
    },
    {
      name: 'mailbox',
      left: 0.5111,
      top: 0.04166,
      width: 0.01388,
      height: 0.07083,
      classes: 'person'
    },
  ];

  globals.whitelistedAreas.forEach((area) => {
    area.bbox = [
      area.left * globals.width,
      area.top * globals.height,
      area.width * globals.width,
      area.height * globals.height
    ];
  });

  globals.restrictedArea = {
    left: 0.1111,
    top: 0.125,
    width: 0.625,
    height: 0.8333,
  };

  globals.restrictedArea.bbox = [
    globals.restrictedArea.left * globals.width,
    globals.restrictedArea.top * globals.height,
    globals.restrictedArea.width * globals.width,
    globals.restrictedArea.height * globals.height
  ];
}

async function loadVideo() {
  return new Promise((resolve, reject) => {
    let req = new XMLHttpRequest();
    req.open('GET', `/recordings/raw/${videoId}`, true);
    req.responseType = 'blob';
    req.onload = async function() {
      if (this.status === 200) {
        video.src = URL.createObjectURL(this.response);
        setTimeout(() => {
          console.log(video.videoWidth, video.videoHeight);
          globals.height = video.videoHeight;
          globals.width = video.videoWidth;
          video.height = globals.height;
          video.width = globals.width;
          globals.quarterSize = (globals.width * globals.height) / 4;
          globals.emptyArray = new Array(globals.quarterSize).fill(0);
          return resolve();
        }, 1000);
      } else {
        reject(this.status);
      }
    };
    req.onerror = reject;
    req.send();
  });
}

async function stepVideoForward(recentDetection) {
  debugTiming && console.time('seek');
  let step = (1 / 30);
  // Every 5th frame instead when no recent detections
  if (!recentDetection) {
    step = step * 5;
  }
  return new Promise(async (resolve, reject) => {
    let newPos = video.currentTime + step;
    if (newPos < video.duration - 5) {
      video.currentTime = newPos;
      await playerEvents.waitForVideoReady();
      debugTiming && console.timeEnd('seek');
      return resolve(true);
    } else {
      debugTiming && console.timeEnd('seek');
      return resolve(false);
    }
  });
}

function initializeCapture() {
  globals.capture = new WebMWriter({
    quality: 0.8,
    fileWriter: null,
    fd: null,
    frameRate: 30
  });
}

async function processVideo() {
  // How many frames should we care about after an object was detected
  const objectDetectionFalloff = 5;
  let currentFrame = 0;
  let lastObjectDetectionFrame = currentFrame - objectDetectionFalloff;

  // Object detection model
  let model = await cocoSsd.load();//'mobilenet_v2');
  let recentObjectDetection = false;

  while (await stepVideoForward(recentObjectDetection || currentFrame === 0)) {
    let results;
    let motionDetected;
    let time = video.currentTime;

    recentObjectDetection = currentFrame - lastObjectDetectionFrame < objectDetectionFalloff;
    console.time('processFrame');

    if (currentFrame % 20 === 0) {
      console.log('step', currentFrame);
    }

    // If an object was not recently detected, check for basic motion in restricted area before spending resources detecting objects
    if (!recentObjectDetection) {
      debugTiming && console.time('detect motion');
      motionDetected = await detectMotionInsideArea(globals.restrictedArea.bbox);
      debugTiming && console.timeEnd('detect motion');
    }

    // If an object was recently detected, or we found motion in restricted area, check for objects in current frame
    if (recentObjectDetection || motionDetected) {
      debugTiming && console.time('detect objects');
      results = await model.detect(video);
      debugTiming && console.timeEnd('detect objects');
    }

    // Filter results against whitelists
    debugTiming && console.time('filter');
    let filteredResults = await filterResults(results);
    debugTiming && console.timeEnd('filter');
    debugTiming && console.time('render');
    if (filteredResults && filteredResults.length) {
      detectionData[time] = filteredResults;
      await renderFrame(video.currentTime, true);
      lastObjectDetectionFrame = currentFrame;
    } else if (currentFrame - lastObjectDetectionFrame < 10) {
      // render a few extra frames after each detection for smoother output
      await renderFrame(video.currentTime, true);
    } else if (motionDetected) {
      await renderFrame(video.currentTime, true);
    }
    debugTiming && console.timeEnd('render');
    console.timeEnd('processFrame');
    currentFrame++;
  }
}

async function clearVideo() {
  // No frames were generated and nothing was detected, we should tell server it was empty
  return new Promise((resolve, reject) => {
    let req = new XMLHttpRequest();
    req.open('POST', `/recordings/${videoId}/clear`, true);
    req.onload = function() {
      if (this.status === 200) {
        console.log('cleared')
      }
      resolve();
    };
    req.onerror = reject;
    req.send();
  })
}

async function uploadVideo() {
  let blob;
  try {
    blob = await globals.capture.complete();
  } catch(e) {
    if (Object.keys(detectionData).length) {
      return console.log('Error capturing blob', e);
    } else {
      // No frames were generated and nothing was detected, we should tell server it was empty
      return clearVideo();
    }
  }

  if (!Object.keys(detectionData).length) {
    return clearVideo()
  }

  return new Promise((resolve, reject) => {
    let fd = new FormData();
    fd.append('video', blob);
    fd.append('detect', JSON.stringify(detectionData));
    let req = new XMLHttpRequest();
    req.open('POST', `/recordings/processed/${videoId}`, true);
    req.onload = function() {
      if (this.status === 200) {
        console.log('uploaded')
      }
      resolve();
    };
    req.onerror = reject;
    req.send(fd);
  });
}

async function main() {
  await loadVideo();

  video.pause();
  video.currentTime = videoSkipToStart;

  await generateCanvases();
  await generateZones();

  initializeCapture();

  await processVideo();
  await uploadVideo();
  window.close();
}

async function renderFrame(time, skipChange) {
  let result = detectionData[time];
  if (!skipChange) {
    video.currentTime = time;
    await wait(200);
  }

  globals.context.clearRect(0, 0, globals.width, globals.height);
  globals.context.drawImage(video, 0, 0, globals.width, globals.height);
  globals.context.font = '10px Arial';

  if (debugAreas) {
    globals.whitelistedAreas.forEach((area) => {
      drawBox(area.bbox, 0, area.name, 'yellow');
    });
    drawBox(globals.restrictedArea.bbox, 0, 'restricted', 'red');
  }

  if (result) {
    for (let i = 0; i < result.length; i++) {
      drawBox(result[i].bbox, result[i].score, result[i].class, 'green');
    }
  }

  let blankFrame = true;
  for (let i = 0; i < globals.quarterSize; i++) {
    if (globals.context.getImageData(0,0, canvas.width, canvas.height).data[i * 4] !== globals.emptyArray[i * 4]) {
      blankFrame = false;
      break;
    }
  }

  if (!blankFrame) {
    globals.capture.addFrame(canvas);
  }
}

function drawBox(bbox, score = 0, classification = '', color) {
  globals.context.beginPath();
  globals.context.rect(...bbox);
  globals.context.lineWidth = 1;
  globals.context.strokeStyle = color || 'green';
  globals.context.fillStyle = color || 'green';
  globals.context.stroke();

  if (score || classification) {
    globals.context.fillText(`${score.toFixed(3)} ${classification}`, bbox[0], bbox[1] > 10 ? bbox[1] - 5 : 10);
  }
}

function intersect(a, b) {
  return Math.max(a[0], b[0]) < Math.min(a[0] + a[2], b[0] + b[2]) &&
    Math.max(a[1], b[1]) < Math.min(a[1] + a[3], b[1] + b[3]);
}

async function detectMotionInsideArea(areaToDetect) {
  let previousFrame = globals.motionDetectionCanvas.getContext('2d').getImageData(0, 0, globals.motionDetectionCanvas.width, globals.motionDetectionCanvas.height);

  // Write current frame
  globals.motionDetectionCanvas.getContext('2d').drawImage(video, areaToDetect[0], areaToDetect[1], areaToDetect[2], areaToDetect[3], 0, 0, areaToDetect[2], areaToDetect[3]);
  let blankFrame = true;

  // Check to see if previousFrame is blank
  for (let i = 0; i < globals.quarterSize; i++) {
    if (previousFrame.data[i * 4] !== globals.emptyArray[i * 4]) {
      blankFrame = false;
      break;
    }
  }

  // If previous frame was blank, return now
  if (blankFrame) {
    return true;
  }

  // Fetch current frame data
  let currentFrame = globals.motionDetectionCanvas.getContext('2d').getImageData(0, 0, globals.motionDetectionCanvas.width, globals.motionDetectionCanvas.height);

  // Calculate diff between current and previous frame
  let diff = 0;
  for (let i = 0; i < globals.quarterSize; i++) {
    diff += Math.abs(currentFrame.data[16 * i] - previousFrame.data[16 * i]) / 255;
    diff += Math.abs(currentFrame.data[16 * i + 1] - previousFrame.data[16 * i + 1]) / 255;
    diff += Math.abs(currentFrame.data[16 * i + 2] - previousFrame.data[16 * i + 2]) / 255;
  }
  diff = 100 * diff / ((currentFrame.width / 4) * (currentFrame.height / 4) * 3);

  return diff > 0.3;
}

/**
 * Filters out results from outside restricted area, or within ignored areas for certain classes
 * @param results
 * @return {Promise<void>}
 */
async function filterResults(results) {
  let filteredResults = [];
  filterloop:
    for (let result of results || []) {
      if (classBlacklist.includes(result.class)) {
        continue;
      }
      if (!intersect(result.bbox, globals.restrictedArea.bbox)) {
        continue;
      }
      // Ignore any matching whitelisted areas
      for (let area of globals.whitelistedAreas) {
        if (area.classes.includes(result.class) && intersect(result.bbox, area.bbox)) {
          continue filterloop;
        }
      }
      // Ignore objects larger than 80% of whole restricted area size as they are basically always detection anomalies
      if (
        (result.bbox[2] > (globals.restrictedArea.bbox[2] * 0.8) ) ||
        (result.bbox[3] > (globals.restrictedArea.bbox[3] * 0.8) )
      ) {
        continue;
      }
      filteredResults.push(result);
    }
  return filteredResults;
}


