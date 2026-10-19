const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');
const { createApp } = require('../src/app');
const { HttpError } = require('../src/utils/http-error');

const id = '64c13ab08edf48a008793cac';
const panelId = '64c13ab08edf48a008793cad';
const generatePanelImages = ({ panels }) => panels.map((panel, index) => ({
  ...panel,
  imageUrl: `/generated/00000000-0000-4000-8000-00000000000${index}.jpg`,
  imageSource: 'pollinations',
  status: 'locked',
  variants: []
}));

function createQuery(value) {
  return {
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    select() {
      return this;
    },
    lean: async () => value
  };
}

function createModel(record = null) {
  return class {
    constructor(data) {
      Object.assign(this, data);
    }

    async save() {
      return this;
    }

    static find() {
      return createQuery([]);
    }

    static findById() {
      return createQuery(record);
    }

    static findOne() {
      return createQuery(record);
    }

    static async findOneAndUpdate(_filter, update) {
      return { ...(record || {}), ...update.$set };
    }

    static async exists() {
      return true;
    }

    static async insertMany(records) {
      return records;
    }

    static async bulkWrite() {
      return [];
    }

    static async findByIdAndUpdate() {
      return null;
    }

    static async findByIdAndDelete() {
      return null;
    }
  };
}

describe('Vizzy API', () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = createApp({
      Project: createModel(),
      Panel: createModel(),
      ChatHistory: createModel()
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('reports API health without a database connection', async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      data: { status: 'ok', database: false, aiConfigured: false }
    });
  });

  it('returns supported visual styles without obsolete panel-count options', async () => {
    const response = await fetch(`${baseUrl}/api/options`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.ok(body.data.visualStyles.length > 0);
    assert.equal(Object.hasOwn(body.data, 'panelCounts'), false);
  });

  it('wraps CRUD and conversation-list successes in the JSON success contract', async () => {
    const panelsResponse = await fetch(`${baseUrl}/api/panels?projectId=${id}`);
    const panelsBody = await panelsResponse.json();
    assert.equal(panelsResponse.status, 200);
    assert.deepEqual(panelsBody, { success: true, data: [] });

    const messagesResponse = await fetch(`${baseUrl}/api/chat-histories?projectId=${id}`);
    const messagesBody = await messagesResponse.json();
    assert.equal(messagesResponse.status, 200);
    assert.deepEqual(messagesBody, { success: true, data: [] });
  });

  it('serves generated panel image assets from their public API URLs', async () => {
    const imageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'vizzy-generated-'));
    const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await fs.writeFile(path.join(imageDirectory, 'asset.png'), imageBytes);
    const app = createApp(
      {
        Project: createModel(),
        Panel: createModel(),
        ChatHistory: createModel()
      },
      { imageDirectory }
    );
    const testServer = app.listen(0);
    await new Promise((resolve) => testServer.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${testServer.address().port}/generated/asset.png`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /image\/png/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), imageBytes);
    } finally {
      await new Promise((resolve, reject) => {
        testServer.close((error) => (error ? reject(error) : resolve()));
      });
      await fs.rm(imageDirectory, { recursive: true, force: true });
    }
  });

  it('resets projects, panels, chat history, and generated image cache on explicit request', async () => {
    const imageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'vizzy-reset-'));
    await fs.writeFile(path.join(imageDirectory, '00000000-0000-4000-8000-000000000001.jpg'), 'image');
    await fs.writeFile(path.join(imageDirectory, 'keep.txt'), 'other file');
    const resetModel = (deletedCount) => class extends createModel() {
      static async deleteMany() { return { deletedCount }; }
    };
    const app = createApp({
      Project: resetModel(2),
      Panel: resetModel(4),
      ChatHistory: resetModel(6)
    }, { imageDirectory });
    const testServer = app.listen(0);
    await new Promise((resolve) => testServer.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${testServer.address().port}/api/projects/reset-all`, { method: 'DELETE' });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.success, true);
      assert.deepEqual(body.data.deleted, { projects: 2, panels: 4, messages: 6, imageFiles: 1 });
      assert.equal(await fs.readFile(path.join(imageDirectory, 'keep.txt'), 'utf8'), 'other file');
    } finally {
      await new Promise((resolve, reject) => testServer.close((error) => error ? reject(error) : resolve()));
      await fs.rm(imageDirectory, { recursive: true, force: true });
    }
  });

  it('rejects malformed record IDs', async () => {
    const response = await fetch(`${baseUrl}/api/projects/not-an-id`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, /valid record ID/);
    assert.match(response.headers.get('content-type'), /application\/json/);
  });

  it('rejects malformed JSON with a client error', async () => {
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{'
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, /invalid JSON/i);
    assert.match(response.headers.get('content-type'), /application\/json/);
  });

  it('rejects panel references that are not valid project IDs', async () => {
    const response = await fetch(`${baseUrl}/api/panels`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'not-an-id', position: 0 })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, /valid projectId/);
  });

  it('rejects unsupported request fields', async () => {
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Vizzy', visualStyle: 'bold-ink', unexpected: true })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, /Unsupported field/);
  });

  it('creates projects with a server-enforced style lock', async () => {
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Vizzy', visualStyle: 'bold-ink' })
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.styleLocked, true);
  });

  it('returns 404 for an unknown valid record ID', async () => {
    const response = await fetch(`${baseUrl}/api/projects/${id}`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.message, 'Project not found.');
  });

  it('returns JSON for unknown routes instead of Express HTML', async () => {
    const response = await fetch(`${baseUrl}/does-not-exist`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), { success: false, error: { message: 'Not found.', code: 'NOT_FOUND' } });
  });

  it('returns the strict JSON error contract for backend errors', async () => {
    const app = createApp(
      {
        Project: createModel({ _id: id, visualStyle: 'bold-ink', styleLocked: true }),
        Panel: createModel(),
        ChatHistory: createModel()
      },
      {
        generateStoryboard: async () => {
          throw new HttpError(503, 'Provider is not configured.', 'AI_PROVIDER_NOT_CONFIGURED');
        }
      }
    );
    const testServer = app.listen(0);
    await new Promise((resolve) => testServer.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${testServer.address().port}/api/projects/${id}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief: 'A moon garden.' })
      });
      assert.equal(response.status, 503);
      assert.match(response.headers.get('content-type'), /application\/json/);
      assert.equal(response.headers.get('x-error-code'), 'AI_PROVIDER_NOT_CONFIGURED');
      assert.deepEqual(await response.json(), { success: false, error: { message: 'Provider is not configured.', code: 'AI_PROVIDER_NOT_CONFIGURED' } });
    } finally {
      await new Promise((resolve, reject) => {
        testServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('returns a JSON error when panel image generation fails', async () => {
    const app = createApp(
      {
        Project: createModel({ _id: id, visualStyle: 'bold-ink', styleLocked: true }),
        Panel: createModel(),
        ChatHistory: createModel()
      },
      {
        generateStoryboard: async () => ({
          panels: Array.from({ length: 3 }, (_, index) => ({
            title: `Frame ${index + 1}`,
            narration: 'A connected story beat.',
            visualPrompt: 'A specific scene with a clear subject.'
          }))
        }),
        generatePanelImages: async () => { throw new Error('All image providers failed.'); }
      }
    );
    const testServer = app.listen(0);
    await new Promise((resolve) => testServer.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${testServer.address().port}/api/projects/${id}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief: 'A lantern appears in the fog.' })
      });
      assert.equal(response.status, 502);
      assert.match(response.headers.get('content-type'), /application\/json/);
      assert.deepEqual(await response.json(), {
        success: false,
        error: { message: 'Could not generate the storyboard images. Please retry.', code: 'IMAGE_GENERATION_FAILED' }
      });
    } finally {
      await new Promise((resolve, reject) => testServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('persists generated panels and conversation messages through the API', async () => {
    class GeneratedPanelModel extends createModel() {
      static async insertMany(records) {
        return records.map((record) => ({ ...record, _id: panelId }));
      }
    }
    const app = createApp(
      {
        Project: createModel({ _id: id, visualStyle: 'bold-ink', styleLocked: true }),
        Panel: GeneratedPanelModel,
        ChatHistory: createModel()
      },
      {
        generateStoryboard: async () => ({
          panels: Array.from({ length: 3 }, (_, index) => ({
            title: `The key ${index + 1}`,
            narration: 'The story moves forward.',
            visualPrompt: 'A hero discovers a glowing map in a mystical forest.'
          }))
        }),
        generatePanelImages
      }
    );
    const testServer = app.listen(0);
    await new Promise((resolve) => testServer.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${testServer.address().port}/api/projects/${id}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief: 'A small fox finds a key.' })
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.match(body.imageUrl, /^\/generated\//);
      assert.equal(body.success, true);
      assert.equal(body.data.panels.length, 3);
      assert.equal(body.data.messages.length, 2);
      assert.equal(body.data.panels[0].position, 0);
      assert.equal(body.data.generation.source, 'ai');
      assert.match(body.data.panels[0].imageUrl, /^\/generated\//);
      assert.equal(body.data.panels[0].imageSource, 'pollinations');
      assert.equal(body.data.panels[0].status, 'locked');
      assert.equal(body.data.generation.status, 'complete');
      assert.equal(body.data.generation.panelsAdded, 3);
      assert.equal(String(body.data.messages[1].panelId), panelId);
    } finally {
      await new Promise((resolve, reject) => {
        testServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('reorders storyboard frames and returns the ordered JSON data', async () => {
    const orderedPanels = [
      { _id: panelId, projectId: id, position: 0, title: 'First' },
      { _id: '64c13ab08edf48a008793cae', projectId: id, position: 1, title: 'Second' }
    ];
    class OrderedPanelModel extends createModel() {
      static find() {
        return createQuery([...orderedPanels].sort((left, right) => left.position - right.position));
      }

      static async bulkWrite(operations) {
        for (const operation of operations) {
          const { filter, update } = operation.updateOne;
          const panel = orderedPanels.find((item) => String(item._id) === String(filter._id));
          if (panel) panel.position = update.$set.position;
        }
      }
    }
    const app = createApp({
      Project: createModel({ _id: id, visualStyle: 'bold-ink', styleLocked: true }),
      Panel: OrderedPanelModel,
      ChatHistory: createModel()
    });
    const testServer = app.listen(0);
    await new Promise((resolve) => testServer.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${testServer.address().port}/api/projects/${id}/panels/reorder`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ panelId, direction: 'down' })
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.success, true);
      assert.deepEqual(body.data.map((panel) => panel.title), ['Second', 'First']);
      assert.deepEqual(body.data.map((panel) => panel.position), [0, 1]);
    } finally {
      await new Promise((resolve, reject) => testServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('keeps adding a directly illustrated scene when Gemini is unavailable', async () => {
    const app = createApp(
      {
        Project: createModel({ _id: id, visualStyle: 'bold-ink', styleLocked: true }),
        Panel: createModel(),
        ChatHistory: createModel()
      },
      {
        generateStoryboard: async () => ({
          source: 'direct',
          warning: 'Gemini is rate-limited; used the story beat directly.',
          panels: Array.from({ length: 3 }, (_, index) => ({
            title: `A glowing map ${index + 1}`,
            narration: 'A hero finds a glowing map.',
            visualPrompt: 'A hero discovers a glowing map.'
          }))
        }),
        generatePanelImages
      }
    );
    const testServer = app.listen(0);
    await new Promise((resolve) => testServer.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${testServer.address().port}/api/projects/${id}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief: 'A small fox finds a key.' })
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.data.generation.source, 'direct');
      assert.match(body.data.generation.warning, /rate-limited/);
      assert.equal(body.data.panels.length, 3);
      assert.equal(body.data.panels[0].source, 'direct');
      assert.equal(body.data.panels[0].imageSource, 'pollinations');
      assert.doesNotMatch(body.data.messages[1].content, /mock|three visual directions/i);
    } finally {
      await new Promise((resolve, reject) => {
        testServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
