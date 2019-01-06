const qs = require('querystring');

const request = require('request');

const config = require('./config');

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

let jar = request.jar();

function Unifi() {}

async function makeRequest(options) {
  return new Promise((resolve) => {
    request(options, (err, response, body) => {
      if (err) {
        throw err;
      } else {
        return resolve([response, body]);
      }
    })
  });
}

function makeStreamingRequest(options) {
  return request(options);
}

Unifi.prototype.authenticate = async function authenticate() {
  let options = {
    url: `${config.unifi.host}/api/2.0/login`,
    jar: jar,
    json: {
      username: config.unifi.email,
      password: config.unifi.password
    },
    headers: {
      'Referer': `${config.unifi.host}/login`,
      'Origin': config.unifi.host
    },
    method: 'POST'
  };
  return makeRequest(options);
};

Unifi.prototype.findRecordings = async function(startDate) {
  let queryString = {
    cause: [
      'motionRecording',
    ],
    startTime: startDate.getTime(),
    idsOnly: true,
    sort: 'asc'
  };
  let options = {
    url: `${config.unifi.host}/api/2.0/recording?${qs.stringify(queryString)}`,
    jar: jar,
    json: true,
    method: 'GET'
  };
  return makeRequest(options);
};

Unifi.prototype.getRecording = async function(id) {
  let options = {
    url: `${config.unifi.host}/api/2.0/recording/${id}`,
    jar: jar,
    method: 'GET',
    json: true,
    encoding: null
  };
  let [response, body] = await makeRequest(options);
  return {
    camera: body.data[0].meta.cameraName,
    startTime: body.data[0].startTime,
    endTime: body.data[0].endTime
  };
};

Unifi.prototype.streamRecording = function(id) {
  let options = {
    url: `${config.unifi.host}/api/2.0/recording/${id}/download`,
    jar: jar,
    method: 'GET',
    encoding: null
  };
  return makeStreamingRequest(options);
};

Unifi.prototype.getCameraInfo = async function() {
  let options = {
    url: `${config.unifi.host}/api/2.0/bootstrap`,
    jar: jar,
    method: 'GET',
    encoding: null
  };
  return makeRequest(options);
};

Unifi.prototype.getSnapshot = async function(cameraId) {
  let options = {
    url: `${config.unifi.host}/api/2.0/snapshot/camera/${cameraId}?force=true`,
    jar: jar,
    method: 'GET',
    encoding: null
  };
  return makeRequest(options);
};

Unifi.prototype.fetchRecordings = async function(startDate) {
  let [response, body] = await this.findRecordings(startDate);
  if (response.statusCode !== 200) {
    console.log('Fetch recordings failed, status code', response.statusCode, 'received');
    if (response.statusCode === 401) {
      console.log('Attempting to reauthenticate');
      await this.authenticate();
      [response, body] = await this.findRecordings(startDate);
      if (response.statusCode !== 200) {
        throw new Error('Potential credentials issue, request failed even after authentication');
      }
    } else {
      throw new Error('Unknown failure fetching recordings');
    }
  }
  return body.data;
};

module.exports = Unifi;
