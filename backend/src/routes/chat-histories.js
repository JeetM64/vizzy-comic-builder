const express = require('express');
const mongoose = require('mongoose');
const { HttpError } = require('../utils/http-error');

function createChatHistoryRouter(ChatHistory) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const { projectId } = req.query;
      if (!projectId || !mongoose.isValidObjectId(projectId)) {
        throw new HttpError(400, 'A valid projectId query parameter is required.');
      }
      const recentMessages = await ChatHistory.find({ projectId })
        .sort({ createdAt: -1, _id: -1 })
        .limit(100)
        .lean();
      const messages = recentMessages.reverse();
      res.json({ success: true, data: messages });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createChatHistoryRouter;
