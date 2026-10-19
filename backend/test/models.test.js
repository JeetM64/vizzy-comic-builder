const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const Project = require('../src/models/project');
const Panel = require('../src/models/panel');
const ChatHistory = require('../src/models/chat-history');

describe('Mongoose models', () => {
  it('requires a project name and defaults new projects to draft', async () => {
    const missingName = new Project();
    await assert.rejects(missingName.validate(), /name/);

    const project = new Project({ name: '  First comic  ', visualStyle: 'bold-ink' });
    await project.validate();
    assert.equal(project.name, 'First comic');
    assert.equal(project.status, 'draft');
  });

  it('requires a project reference and non-negative integer position for panels', async () => {
    const missingFields = new Panel();
    await assert.rejects(missingFields.validate(), /projectId/);

    const invalidPosition = new Panel({
      projectId: '64c13ab08edf48a008793cac',
      position: 1.5
    });
    await assert.rejects(invalidPosition.validate(), /position must be an integer/);
  });

  it('accepts Pollinations artwork URLs and defaults panels to locked', async () => {
    const panel = new Panel({
      projectId: '64c13ab08edf48a008793cac',
      position: 0,
      imageUrl: 'https://image.pollinations.ai/prompt/locked%20style?width=1024',
      imageSource: 'pollinations'
    });
    await panel.validate();
    assert.equal(panel.status, 'locked');
    assert.equal(panel.imageSource, 'pollinations');

    const invalidPanel = new Panel({
      projectId: '64c13ab08edf48a008793cac',
      position: 0,
      imageUrl: 'https://example.com/image.png',
      imageSource: 'pollinations'
    });
    await assert.rejects(invalidPanel.validate(), /imageUrl/);
  });

  it('accepts Gemini generated image assets as panel artwork', async () => {
    const panel = new Panel({
      projectId: '64c13ab08edf48a008793cac',
      position: 0,
      imageUrl: '/generated/11111111-1111-4111-8111-111111111111.png',
      imageSource: 'gemini-image'
    });
    await panel.validate();
    assert.equal(panel.imageSource, 'gemini-image');
  });

  it('rejects obsolete multi-variant and placeholder image panel states', async () => {
    const panel = new Panel({
      projectId: '64c13ab08edf48a008793cac',
      position: 0,
      title: 'Fallback frame',
      imageUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
      imageSource: 'pollinations'
    });
    await assert.rejects(panel.validate(), /imageUrl/);
  });

  it('requires a valid chat role and non-empty content', async () => {
    const chatEntry = new ChatHistory({
      projectId: '64c13ab08edf48a008793cac',
      role: 'tool',
      content: 'hello'
    });
    await assert.rejects(chatEntry.validate(), /role/);
  });

  it('locks the visual style after project creation', async () => {
    const project = new Project({
      name: 'Locked style',
      visualStyle: 'watercolor',
      styleLocked: false
    });
    await project.validate();
    assert.equal(project.styleLocked, true);
  });

  it('persists character continuity anchors on a project', async () => {
    const project = new Project({
      name: 'Recurring cast',
      visualStyle: 'bold-ink',
      characterAnchors: ['Mara wears a red scarf and carries a brass compass.']
    });
    await project.validate();
    assert.equal(project.characterAnchors[0], 'Mara wears a red scarf and carries a brass compass.');
  });
});
