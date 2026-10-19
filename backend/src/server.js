const mongoose = require('mongoose');
const {
  loadEnvironment,
  getMongoUri,
  getMongoConnectionOptions,
  getPort
} = require('./config/environment');
const { createApp } = require('./app');
const { startupCleanup } = require('./services/startup-cleanup');

loadEnvironment();

async function startServer() {
  const mongoUri = getMongoUri();
  const port = getPort(process.env.PORT || 4000);

  await connectDatabase(mongoUri);
  await startupCleanup();

  const server = createApp().listen(port);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  console.log(`Vizzy API listening on port ${port}`);
  return server;
}

function isMongoAuthenticationError(error) {
  return error?.code === 13 ||
    error?.code === 18 ||
    error?.codeName === 'Unauthorized' ||
    error?.codeName === 'AuthenticationFailed' ||
    /authentication failed|requires authentication|not authorized/i.test(error?.message || '');
}

async function connectDatabase(uri, mongooseClient = mongoose, logger = console) {
  try {
    return await mongooseClient.connect(uri, getMongoConnectionOptions(uri));
  } catch (error) {
    if (isMongoAuthenticationError(error)) {
      logger.warn(
        'MongoDB authentication was rejected. Check that MONGODB_URI has the correct username and password, ' +
        'that authSource names the database where the user was created (often admin), and that the user has ' +
        'the required database roles. Percent-encode reserved credential characters such as @ as %40. ' +
        'The API will not start until the database connection succeeds.'
      );
    }
    throw error;
  }
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Unable to start Vizzy API:', error);
    process.exitCode = 1;
  });
}

module.exports = { connectDatabase, isMongoAuthenticationError, startServer };
