const path = require('path');

module.exports = {
  fileHostUrl: 'https://fileHost.domain.orIp',
  hostJob: {
    fileHost: true, // Is the server running this where we will host all recording files
    processor: true // Is this server where we will process the raw recordings
  },
  unifi: {
    host: 'http://ipOrDomainOfUnifiNvr',
    email: 'your username/email for unifi',
    password: 'your password'
  },
  recordings: {
    // where should we store processed videos
    processedOutputPath: path.resolve(__dirname + '/processedVideos/')
  },
  firebaseUrl: 'https://your-project-id.firebaseio.com'
};
