const express = require('express');
const mongoose = require('mongoose');
const { TONES } = require('../config/story-options');
const { generateStoryboard } = require('../services/storyboard-generator');
const { generatePanelImages } = require('../services/panel-image-generator');
const { HttpError } = require('../utils/http-error');

const PROJECT_CREATE_FIELDS = ['name', 'description', 'paletteNotes', 'visualStyle', 'characterAnchors'];
const PROJECT_UPDATE_FIELDS = ['name', 'description', 'paletteNotes', 'status', 'characterAnchors'];

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function validateId(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, 'A valid record ID is required.');
  }
}

function validateBody(body, allowedFields, allowEmpty = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'The request body must be a JSON object.');
  }
  const unsupported = Object.keys(body).filter((key) => !allowedFields.includes(key));
  if (unsupported.length) {
    throw new HttpError(400, `Unsupported field(s): ${unsupported.join(', ')}.`);
  }
  if (!allowEmpty && Object.keys(body).length === 0) {
    throw new HttpError(400, 'At least one field is required.');
  }
  return body;
}

function normalizeCharacterAnchors(value) {
  const rawAnchors = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : null;
  if (!rawAnchors || rawAnchors.some((anchor) => typeof anchor !== 'string')) {
    throw new HttpError(400, 'Provide at most 12 character continuity notes, each no longer than 500 characters.');
  }
  const anchors = rawAnchors.map((anchor) => anchor.trim()).filter(Boolean);
  if (anchors.length > 12 || anchors.some((anchor) => anchor.length > 500)) {
    throw new HttpError(400, 'Provide at most 12 character continuity notes, each no longer than 500 characters.');
  }
  return anchors;
}

function createProjectsRouter(models, options = {}) {
  const router = express.Router();
  const runGeneration = options.generateStoryboard || generateStoryboard;
  const runImageGeneration = options.generatePanelImages || generatePanelImages;

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const projects = await models.Project.find().sort({ updatedAt: -1 }).limit(100).lean();
      res.json({ success: true, data: projects });
    })
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const payload = validateBody(req.body, PROJECT_CREATE_FIELDS, true);
      if (typeof payload.name !== 'string' || !payload.name.trim()) {
        throw new HttpError(400, 'Project name is required.');
      }
      if (payload.characterAnchors !== undefined) {
        if (typeof payload.characterAnchors === 'string' && payload.characterAnchors.length > 6000) {
          throw new HttpError(400, 'Character continuity notes must be text up to 6000 characters.');
        }
        payload.characterAnchors = normalizeCharacterAnchors(payload.characterAnchors);
      }
      const project = await new models.Project({ ...payload, styleLocked: true }).save();
      res.status(201).json({ success: true, data: project });
    })
  );

  router.post(
    '/:id/generate',
    asyncHandler(async (req, res) => {
      validateId(req.params.id);
      const body = validateBody(req.body, ['brief', 'tone', 'panelCount']);
      const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
      if (!brief || brief.length > 5000) {
        throw new HttpError(400, 'brief must contain between 1 and 5000 characters.');
      }
      const tone = body.tone || TONES[0].id;
      if (!TONES.some((option) => option.id === tone)) {
        throw new HttpError(400, 'Choose a supported tone.');
      }
      const panelCount = body.panelCount === undefined ? 3 : Number(body.panelCount);
      if (!Number.isInteger(panelCount) || panelCount < 3 || panelCount > 6) {
        throw new HttpError(400, 'panelCount must be an integer from 3 to 6.');
      }

      const project = await models.Project.findById(req.params.id).lean();
      if (!project) {
        throw new HttpError(404, 'Project not found.');
      }
      if (project.styleLocked !== true) {
        throw new HttpError(409, 'The project visual style must be locked before generation.');
      }

      const recentConversation = await models.ChatHistory.find({ projectId: project._id })
        .sort({ createdAt: -1, _id: -1 })
        .limit(20)
        .lean();
      const conversation = recentConversation.reverse();
      const storyboard = await runGeneration({
        project,
        brief,
        tone,
        panelCount,
        conversation
      });
      if (!Array.isArray(storyboard.panels) || storyboard.panels.length < 3 || storyboard.panels.length > 6) {
        throw new HttpError(502, 'The story generator must return a sequence of 3 to 6 panels.');
      }
      const latestPanel = await models.Panel.findOne({ projectId: project._id })
        .sort({ position: -1 })
        .select('position')
        .lean();
      const firstPosition = latestPanel ? latestPanel.position + 1 : 0;
      let imagePanels;
      try {
        imagePanels = await runImageGeneration({
          project,
          panels: storyboard.panels
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, 'Could not generate the storyboard images. Please retry.', 'IMAGE_GENERATION_FAILED');
      }
      const generationSource = storyboard.source === 'direct' ? 'direct' : 'ai';
      const panels = await models.Panel.insertMany(
        imagePanels.map((panel, index) => ({
          ...panel,
          source: generationSource,
          projectId: project._id,
          position: firstPosition + index
        }))
      );
      const imageSources = [...new Set(panels.map((panel) => panel.imageSource))];

      const assistantReply = [
        storyboard.summary || `That’s a great story beat: ${brief}`,
        storyboard.followUp || 'What happens next?',
        storyboard.warning
      ].filter(Boolean).join(' ');
      const messages = await models.ChatHistory.insertMany([
        { projectId: project._id, role: 'user', content: brief, tone },
        {
          projectId: project._id,
          panelId: panels[0]._id,
          panelIds: panels.map((panel) => panel._id),
          role: 'assistant',
          content: assistantReply,
          generationSource
        }
      ]);

      res.status(200).json({
        success: true,
        imageUrl: panels[0]?.imageUrl || null,
        data: {
          panels,
          frames: panels,
          messages,
          generation: {
            source: generationSource,
            warning: storyboard.warning || null,
            imageSource: imageSources.length === 1 ? imageSources[0] : 'mixed',
            panelsAdded: panels.length,
            status: 'complete'
          }
        }
      });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      validateId(req.params.id);
      const project = await models.Project.findById(req.params.id).lean();
      if (!project) {
        throw new HttpError(404, 'Project not found.');
      }
      res.json({ success: true, data: project });
    })
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      validateId(req.params.id);
      const payload = validateBody(req.body, PROJECT_UPDATE_FIELDS);
      if (payload.characterAnchors !== undefined) {
        payload.characterAnchors = normalizeCharacterAnchors(payload.characterAnchors);
      }
      const project = await models.Project.findByIdAndUpdate(req.params.id, payload, {
        new: true,
        runValidators: true
      });
      if (!project) {
        throw new HttpError(404, 'Project not found.');
      }
      res.json({ success: true, data: project });
    })
  );

  router.post(
    '/:id/panels/reorder',
    asyncHandler(async (req, res) => {
      validateId(req.params.id);
      const body = validateBody(req.body, ['panelId', 'direction']);
      validateId(body.panelId);
      if (!['up', 'down'].includes(body.direction)) {
        throw new HttpError(400, 'direction must be "up" or "down".');
      }
      const project = await models.Project.findById(req.params.id).lean();
      if (!project) throw new HttpError(404, 'Project not found.');

      const panels = await models.Panel.find({ projectId: project._id }).sort({ position: 1 }).lean();
      const currentIndex = panels.findIndex((panel) => String(panel._id) === body.panelId);
      if (currentIndex === -1) throw new HttpError(404, 'Panel not found.');
      const neighborIndex = currentIndex + (body.direction === 'up' ? -1 : 1);
      if (neighborIndex < 0 || neighborIndex >= panels.length) {
        throw new HttpError(409, 'This frame is already at the edge of the storyboard.');
      }

      const moved = [...panels];
      [moved[currentIndex], moved[neighborIndex]] = [moved[neighborIndex], moved[currentIndex]];
      await models.Panel.bulkWrite(moved.map((panel, position) => ({
        updateOne: {
          filter: { _id: panel._id, projectId: project._id },
          update: { $set: { position: 1000000 + position } }
        }
      })));
      await models.Panel.bulkWrite(moved.map((panel, position) => ({
        updateOne: {
          filter: { _id: panel._id, projectId: project._id },
          update: { $set: { position } }
        }
      })));
      const reordered = await models.Panel.find({ projectId: project._id }).sort({ position: 1 }).lean();
      res.json({ success: true, data: reordered });
    })
  );

  return router;
}

module.exports = createProjectsRouter;
