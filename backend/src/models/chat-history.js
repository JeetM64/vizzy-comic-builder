const mongoose = require('mongoose');
const { TONES } = require('../config/story-options');

const chatHistorySchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true
    },
    panelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Panel'
    },
    panelIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Panel' }],
    role: {
      type: String,
      enum: ['user', 'assistant', 'system'],
      required: true
    },
    tone: {
      type: String,
      enum: TONES.map((tone) => tone.id)
    },
    generationSource: {
      type: String,
      enum: ['ai', 'direct']
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 10000
    }
  },
  { timestamps: true }
);

chatHistorySchema.index({ projectId: 1, createdAt: 1 });

module.exports = mongoose.model('ChatHistory', chatHistorySchema);
