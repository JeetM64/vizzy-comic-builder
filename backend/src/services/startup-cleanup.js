const fs = require('node:fs/promises');
const path = require('node:path');
const Project = require('../models/project');
const Panel = require('../models/panel');
const ChatHistory = require('../models/chat-history');
const { DEFAULT_IMAGE_DIRECTORY } = require('./panel-image-generator');

const TEST_PROJECT_NAME = /^(?:test|junk|dummy|seed|sample)(?:\s+(?:project|comic|story))?$/i;
const GENERATED_IMAGE_NAME = /^[a-f0-9-]+\.(?:png|jpg|webp)$/i;

async function startupCleanup(options = {}) {
  const models = options.models || { Project, Panel, ChatHistory };
  const imageDirectory = options.imageDirectory || DEFAULT_IMAGE_DIRECTORY;
  const projects = await models.Project.find().select('_id name').lean();
  const testProjectIds = projects
    .filter((project) => TEST_PROJECT_NAME.test(String(project.name || '').trim()))
    .map((project) => project._id);
  if (testProjectIds.length) await models.Project.deleteMany({ _id: { $in: testProjectIds } });

  const retainedProjects = projects.filter((project) => !testProjectIds.some((id) => String(id) === String(project._id)));
  const projectIds = retainedProjects.map((project) => project._id);
  const panels = await models.Panel.find().select('_id projectId imageUrl').lean();
  const retainedProjectIds = new Set(projectIds.map(String));
  const invalidPanelIds = [];
  const referencedImageNames = new Set();

  for (const panel of panels) {
    let invalid = !retainedProjectIds.has(String(panel.projectId)) || typeof panel.imageUrl !== 'string' || !panel.imageUrl.trim();
    const match = typeof panel.imageUrl === 'string' && panel.imageUrl.match(/^\/generated\/([a-f0-9-]+\.(?:png|jpg|webp))$/i);
    if (!invalid && match) {
      const imageName = path.basename(match[1]);
      try {
        const stats = await fs.stat(path.join(imageDirectory, imageName));
        if (!stats.isFile() || stats.size === 0) invalid = true;
        else referencedImageNames.add(imageName.toLowerCase());
      } catch (error) {
        if (error.code === 'ENOENT') invalid = true;
        else throw error;
      }
    }
    if (invalid) invalidPanelIds.push(panel._id);
  }

  if (invalidPanelIds.length) {
    await models.Panel.deleteMany({ _id: { $in: invalidPanelIds } });
    await models.ChatHistory.updateMany(
      { $or: [{ panelId: { $in: invalidPanelIds } }, { panelIds: { $in: invalidPanelIds } }] },
      { $unset: { panelId: 1 }, $set: { panelIds: [] } }
    );
  }
  await models.ChatHistory.deleteMany({ projectId: { $nin: projectIds } });

  let staleImagesRemoved = 0;
  try {
    const entries = await fs.readdir(imageDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !GENERATED_IMAGE_NAME.test(entry.name)) continue;
      if (referencedImageNames.has(entry.name.toLowerCase())) continue;
      await fs.unlink(path.join(imageDirectory, entry.name));
      staleImagesRemoved += 1;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return {
    testProjectsRemoved: testProjectIds.length,
    brokenPanelsRemoved: invalidPanelIds.length,
    staleImagesRemoved
  };
}

module.exports = { startupCleanup, TEST_PROJECT_NAME };
