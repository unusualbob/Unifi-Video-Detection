const mongoose = require('mongoose');

mongoose.connect('mongodb://localhost:27017/unifi-tensor', { useNewUrlParser: true });
mongoose.set('useCreateIndex', true);

// Require db models here
require('./models/recording');
require('./models/authorizedKey');
require('./models/oneTimeAuth');
require('./models/notificationToken');
