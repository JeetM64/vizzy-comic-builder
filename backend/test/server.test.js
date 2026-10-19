const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { connectDatabase, isMongoAuthenticationError } = require('../src/server');

describe('MongoDB startup connection handling', () => {
  it('passes the configured authSource through to Mongoose', async () => {
    let connection;
    const mongooseClient = {
      connect: async (...args) => {
        connection = args;
      }
    };

    await connectDatabase(
      'mongodb://comic-user:p%40ss@localhost:27017/vizzy_db?authSource=mydb',
      mongooseClient
    );

    assert.deepEqual(connection, [
      'mongodb://comic-user:p%40ss@localhost:27017/vizzy_db?authSource=mydb',
      { authSource: 'mydb' }
    ]);
  });

  it('logs actionable authentication guidance and keeps startup failure explicit', async () => {
    const warnings = [];
    const error = Object.assign(new Error('Command find requires authentication'), {
      code: 13,
      codeName: 'Unauthorized'
    });
    const mongooseClient = { connect: async () => { throw error; } };
    const logger = { warn: (message) => warnings.push(message) };

    await assert.rejects(
      connectDatabase('mongodb://localhost:27017/vizzy_db', mongooseClient, logger),
      (caught) => caught === error
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /authSource/);
    assert.match(warnings[0], /%40/);
    assert.match(warnings[0], /will not start/);
  });

  it('recognizes MongoDB authentication and authorization failures', () => {
    assert.equal(isMongoAuthenticationError({ code: 18 }), true);
    assert.equal(isMongoAuthenticationError({ codeName: 'Unauthorized' }), true);
    assert.equal(isMongoAuthenticationError(new Error('Authentication failed')), true);
    assert.equal(isMongoAuthenticationError(new Error('Connection timed out')), false);
  });
});
