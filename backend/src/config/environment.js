const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const DEFAULT_MONGODB_URI = 'mongodb://127.0.0.1:27017/vizzy_db';

function resolveEnvPath(rootDirectory, fileExists = fs.existsSync) {
  const candidates = [...new Set([
    process.env.ENV_FILE,
    path.join(process.cwd(), '.env'),
    path.join(rootDirectory, 'backend', '.env'),
    path.join(rootDirectory, '.env')
  ].filter(Boolean))];

  return candidates.find((candidate) => fileExists(candidate)) || null;
}

function loadEnvironment(options = {}) {
  const rootDirectory = options.rootDirectory || path.resolve(__dirname, '../../../');
  const fileExists = options.fileExists || fs.existsSync;
  const envPath = resolveEnvPath(rootDirectory, fileExists);
  if (!envPath) return null;
  const config = options.config || dotenv.config;
  const candidates = [...new Set([
    process.env.ENV_FILE,
    path.join(rootDirectory, 'backend', '.env'),
    path.join(process.cwd(), '.env'),
    path.join(rootDirectory, '.env')
  ].filter((candidate) => candidate && fileExists(candidate)))];
  if (!candidates.includes(envPath)) candidates.push(envPath);
  for (const candidate of candidates) {
    const result = config({ path: candidate });
    if (result.error) {
      throw new Error(`Unable to load environment file at ${candidate}: ${result.error.message}`);
    }
  }
  return envPath;
}

function normalizeMongoUri(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('MONGODB_URI must be a non-empty MongoDB connection string.');
  }

  const uri = value.trim();
  const match = uri.match(/^(mongodb(?:\+srv)?):\/\/([^/?#]+)(.*)$/i);
  if (!match || /\s|#/.test(uri)) {
    throw new Error('MONGODB_URI is invalid. Use a mongodb:// or mongodb+srv:// connection string.');
  }

  const [, protocol, authority, suffix] = match;
  const separator = authority.lastIndexOf('@');
  const host = separator === -1 ? authority : authority.slice(separator + 1);
  if (!host || host.includes('@')) {
    throw new Error('MONGODB_URI must include a valid MongoDB host.');
  }

  const hosts = host.split(',');
  if (protocol.toLowerCase() === 'mongodb+srv' && hosts.length !== 1) {
    throw new Error('MONGODB_URI for mongodb+srv must contain exactly one host.');
  }

  try {
    for (const hostEntry of hosts) {
      const parsedHost = new URL(`${protocol}://${hostEntry}`);
      if (
        !parsedHost.hostname ||
        parsedHost.username ||
        parsedHost.password ||
        (protocol.toLowerCase() === 'mongodb+srv' && parsedHost.port)
      ) {
        throw new Error('Invalid host.');
      }
    }
  } catch {
    throw new Error('MONGODB_URI contains an invalid host or port.');
  }

  if (separator === -1) return `${protocol}://${host}${suffix}`;

  const credentials = authority.slice(0, separator);
  const colon = credentials.indexOf(':');
  const username = colon === -1 ? credentials : credentials.slice(0, colon);
  const password = colon === -1 ? null : credentials.slice(colon + 1);
  if (!username) {
    throw new Error('MONGODB_URI credentials must include a username.');
  }

  try {
    const encodedUsername = encodeURIComponent(decodeURIComponent(username));
    const encodedPassword = password === null
      ? null
      : encodeURIComponent(decodeURIComponent(password));
    const encodedCredentials = encodedPassword === null
      ? encodedUsername
      : `${encodedUsername}:${encodedPassword}`;
    return `${protocol}://${encodedCredentials}@${host}${suffix}`;
  } catch {
    throw new Error('MONGODB_URI credentials contain invalid percent-encoding.');
  }
}

function getMongoUri(value = process.env.MONGODB_URI) {
  if (value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return DEFAULT_MONGODB_URI;
  }
  return normalizeMongoUri(value);
}

function getMongoConnectionOptions(value) {
  const uri = normalizeMongoUri(value);
  const queryIndex = uri.indexOf('?');
  if (queryIndex === -1) return {};

  const parameters = new URLSearchParams(uri.slice(queryIndex + 1));
  const authSource = parameters.get('authSource');
  return authSource ? { authSource } : {};
}

function getPort(value = process.env.PORT) {
  const port = Number(value || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return port;
}

module.exports = {
  DEFAULT_MONGODB_URI,
  getPort,
  getMongoConnectionOptions,
  getMongoUri,
  loadEnvironment,
  normalizeMongoUri,
  resolveEnvPath
};
