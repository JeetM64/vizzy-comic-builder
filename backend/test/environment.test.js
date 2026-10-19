const assert = require('node:assert/strict');
const path = require('node:path');
const { describe, it } = require('node:test');
const {
  DEFAULT_MONGODB_URI,
  getPort,
  getMongoConnectionOptions,
  getMongoUri,
  loadEnvironment,
  normalizeMongoUri,
  resolveEnvPath
} = require('../src/config/environment');

describe('backend environment configuration', () => {
  it('prefers backend .env and falls back to the project root .env', () => {
    const root = path.resolve('project');
    const currentDirectoryEnv = path.join(process.cwd(), '.env');
    const backendEnv = path.join(root, 'backend', '.env');
    const rootEnv = path.join(root, '.env');

    assert.equal(
      resolveEnvPath(root, (candidate) => candidate === currentDirectoryEnv),
      currentDirectoryEnv
    );
    assert.equal(
      resolveEnvPath(root, (candidate) => candidate === backendEnv || candidate === rootEnv),
      backendEnv
    );
    assert.equal(resolveEnvPath(root, (candidate) => candidate === rootEnv), rootEnv);
    assert.equal(resolveEnvPath(root, () => false), null);
  });

  it('loads the selected environment file through dotenv', () => {
    const root = path.resolve('workspace');
    const backendEnv = path.join(root, 'backend', '.env');
    let loadedPath;
    const result = loadEnvironment({
      rootDirectory: root,
      fileExists: (candidate) => candidate === backendEnv,
      config: ({ path: selectedPath }) => {
        loadedPath = selectedPath;
        return { parsed: {} };
      }
    });

    assert.equal(loadedPath, backendEnv);
    assert.equal(result, backendEnv);
  });

  it('uses the local development URI only when MONGODB_URI is missing', () => {
    assert.equal(getMongoUri(undefined), DEFAULT_MONGODB_URI);
    assert.equal(getMongoUri('  '), DEFAULT_MONGODB_URI);
  });

  it('defaults the API to port 4000 and validates configured ports', () => {
    assert.equal(getPort(''), 4000);
    assert.equal(getPort('4100'), 4100);
    assert.throws(() => getPort('invalid'), /PORT must be an integer/);
  });

  it('encodes special characters in raw MongoDB credentials safely', () => {
    assert.equal(
      normalizeMongoUri('mongodb://vizzy:p@ssword@localhost:27017/vizzy_db'),
      'mongodb://vizzy:p%40ssword@localhost:27017/vizzy_db'
    );
    assert.equal(
      normalizeMongoUri('mongodb://vizzy:p%40ssword@localhost:27017/vizzy_db'),
      'mongodb://vizzy:p%40ssword@localhost:27017/vizzy_db'
    );
    assert.equal(
      normalizeMongoUri('mongodb://vizzy:p@ssword@db-a:27017,db-b:27017/vizzy_db'),
      'mongodb://vizzy:p%40ssword@db-a:27017,db-b:27017/vizzy_db'
    );
  });

  it('preserves the authentication database in MongoDB URI query parameters', () => {
    const uri = 'mongodb://comic-user:p%40ss@localhost:27017/vizzy_db?authSource=mydb&retryWrites=true';
    assert.equal(normalizeMongoUri(uri), uri);
    assert.deepEqual(getMongoConnectionOptions(uri), { authSource: 'mydb' });
    assert.deepEqual(
      getMongoConnectionOptions('mongodb://comic-user:p%40ss@localhost:27017/vizzy_db?authSource=admin'),
      { authSource: 'admin' }
    );
    assert.deepEqual(getMongoConnectionOptions(DEFAULT_MONGODB_URI), {});
  });

  it('rejects malformed MongoDB URLs and invalid credential encoding', () => {
    assert.throws(() => getMongoUri('not-a-mongo-url'), /MONGODB_URI is invalid/);
    assert.throws(
      () => normalizeMongoUri('mongodb://user:p%ZZ@localhost:27017/vizzy_db'),
      /invalid percent-encoding/
    );
  });
});
