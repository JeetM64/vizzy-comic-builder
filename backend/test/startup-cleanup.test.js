const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { startupCleanup } = require('../src/services/startup-cleanup');

function fakeQuery(value) {
  return { select() { return this; }, lean: async () => value };
}

describe('startup cleanup', () => {
  it('silently prunes test projects, orphaned panels, and unreferenced generated files', async () => {
    const imageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'vizzy-cleanup-'));
    const projectId = 'project-1';
    const testProjectId = 'project-test';
    const validImage = '11111111-1111-4111-8111-111111111111.png';
    const staleImage = '22222222-2222-4222-8222-222222222222.jpg';
    await fs.writeFile(path.join(imageDirectory, validImage), Buffer.from([1]));
    await fs.writeFile(path.join(imageDirectory, staleImage), Buffer.from([1]));
    const calls = { projectDelete: null, panelDelete: null, historyUpdate: null, historyDelete: null };
    const models = {
      Project: {
        find: () => fakeQuery([{ _id: projectId, name: 'New Story' }, { _id: testProjectId, name: 'Test Project' }]),
        deleteMany: async (query) => { calls.projectDelete = query; }
      },
      Panel: {
        find: () => fakeQuery([
          { _id: 'panel-valid', projectId, imageUrl: `/generated/${validImage}` },
          { _id: 'panel-orphan', projectId: 'missing-project', imageUrl: `/generated/${staleImage}` },
          { _id: 'panel-broken', projectId, imageUrl: '' }
        ]),
        deleteMany: async (query) => { calls.panelDelete = query; }
      },
      ChatHistory: {
        updateMany: async (query) => { calls.historyUpdate = query; },
        deleteMany: async (query) => { calls.historyDelete = query; }
      }
    };

    try {
      const result = await startupCleanup({ models, imageDirectory });
      assert.deepEqual(result, { testProjectsRemoved: 1, brokenPanelsRemoved: 2, staleImagesRemoved: 1 });
      assert.deepEqual(calls.projectDelete, { _id: { $in: [testProjectId] } });
      assert.deepEqual(calls.panelDelete, { _id: { $in: ['panel-orphan', 'panel-broken'] } });
      assert.ok(calls.historyUpdate);
      assert.deepEqual(calls.historyDelete, { projectId: { $nin: [projectId] } });
      assert.equal((await fs.readFile(path.join(imageDirectory, validImage))).length, 1);
      await assert.rejects(fs.stat(path.join(imageDirectory, staleImage)), { code: 'ENOENT' });
    } finally {
      await fs.rm(imageDirectory, { recursive: true, force: true });
    }
  });
});
