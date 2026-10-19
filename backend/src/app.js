const express = require('express');
const mongoose = require('mongoose');
const path = require('node:path');
const fs = require('node:fs/promises');
const Project = require('./models/project');
const Panel = require('./models/panel');
const ChatHistory = require('./models/chat-history');
const createCrudRouter = require('./routes/create-crud-router');
const createProjectsRouter = require('./routes/projects');
const createChatHistoryRouter = require('./routes/chat-histories');
const storyOptions = require('./config/story-options');
const { isProviderConfigured } = require('./services/storyboard-generator');
const { DEFAULT_IMAGE_DIRECTORY } = require('./services/panel-image-generator');
const { HttpError } = require('./utils/http-error');

function createApp(models = { Project, Panel, ChatHistory }, options = {}) {
  const app = express();
  const imageDirectory = options.imageDirectory || DEFAULT_IMAGE_DIRECTORY;

  app.use(express.json({ limit: '1mb' }));
  app.use('/generated', express.static(imageDirectory, {
    fallthrough: true,
    maxAge: '7d',
    immutable: true,
    index: false,
    dotfiles: 'deny'
  }));

  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      data: {
        status: 'ok',
        database: options.getDatabaseStatus
          ? options.getDatabaseStatus()
          : mongoose.connection.readyState === 1,
        aiConfigured: options.isAiConfigured
          ? options.isAiConfigured()
          : isProviderConfigured()
      }
    });
  });

  app.get('/api/options', (_req, res) => {
    res.json({
      success: true,
      data: {
        visualStyles: storyOptions.VISUAL_STYLES
      }
    });
  });

  app.delete('/api/projects/reset-all', async (req, res, next) => {
    try {
      const [projects, panels, messages] = await Promise.all([
        models.Project.deleteMany({}),
        models.Panel.deleteMany({}),
        models.ChatHistory.deleteMany({})
      ]);
      let imageFilesRemoved = 0;
      const directory = options.imageDirectory || DEFAULT_IMAGE_DIRECTORY;
      try {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !/^[a-f0-9-]+\.(png|jpg|webp)$/i.test(entry.name)) continue;
          await fs.unlink(path.join(directory, entry.name));
          imageFilesRemoved += 1;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      res.json({ success: true, data: {
        reset: true,
        deleted: {
          projects: projects.deletedCount || 0,
          panels: panels.deletedCount || 0,
          messages: messages.deletedCount || 0,
          imageFiles: imageFilesRemoved
        }
      } });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api/projects', createProjectsRouter(models, options));
  app.use(
    '/api/panels',
    createCrudRouter({
      model: models.Panel,
      fields: ['projectId', 'position', 'panelNumber', 'title', 'narration', 'sceneDescription', 'visualPrompt'],
      filterFields: ['projectId'],
      validate: async (payload) => {
        if (payload.projectId === undefined) return;
        if (!mongoose.isValidObjectId(payload.projectId)) {
          throw new HttpError(400, 'A valid projectId is required.');
        }
        if (!(await models.Project.exists({ _id: payload.projectId }))) {
          throw new HttpError(404, 'Project not found.');
        }
      }
    })
  );
  app.use('/api/chat-histories', createChatHistoryRouter(models.ChatHistory));

  app.use((_req, res) => {
    res.status(404).json({ success: false, error: { message: 'Not found.', code: 'NOT_FOUND' } });
  });

  app.use((err, _req, res, _next) => {
    if (res.headersSent) return;

    if (err instanceof HttpError) {
      if (err.code) res.set('X-Error-Code', err.code);
      return res.status(err.status).json({ success: false, error: { message: err.message, code: err.code || 'REQUEST_ERROR' } });
    }

    if (err.name === 'ValidationError' || err.name === 'CastError') {
      return res.status(400).json({ success: false, error: { message: err.message, code: 'VALIDATION_ERROR' } });
    }

    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ success: false, error: { message: 'Request body contains invalid JSON.', code: 'INVALID_JSON' } });
    }

    if (err.status === 413) {
      return res.status(413).json({ success: false, error: { message: 'Request body exceeds the 1 MB limit.', code: 'BODY_TOO_LARGE' } });
    }

    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, error: { message: 'A record with these values already exists.', code: 'DUPLICATE_RECORD' } });
    }

    console.error(err);
    return res.status(500).json({ success: false, error: { message: 'Internal server error.', code: 'INTERNAL_ERROR' } });
  });

  return app;
}

module.exports = { createApp };
