const mongoose = require('mongoose');

function isValidPanelImageUrl(value) {
  if (typeof value !== 'string') return false;
  if (/^\/generated\/[a-f0-9-]+\.(png|jpg|webp)$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === 'image.pollinations.ai' &&
      url.pathname.startsWith('/prompt/') &&
      url.pathname.length > '/prompt/'.length;
  } catch {
    return false;
  }
}

const panelSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true
    },
    position: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'position must be an integer.'
      }
    },
    panelNumber: {
      type: Number,
      min: 1,
      validate: { validator: Number.isInteger, message: 'panelNumber must be an integer.' }
    },
    title: {
      type: String,
      trim: true,
      maxlength: 120,
      default: ''
    },
    narration: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: ''
    },
    sceneDescription: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: ''
    },
    visualPrompt: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: ''
    },
    imageUrl: {
      type: String,
      required: true,
      validate: {
        validator: isValidPanelImageUrl,
        message: 'imageUrl must point to a generated panel image.'
      }
    },
    imageSource: {
      type: String,
      enum: ['gemini-image', 'huggingface-flux', 'pollinations-flux', 'pollinations'],
      required: true,
      default: 'pollinations'
    },
    status: {
      type: String,
      enum: ['locked'],
      default: 'locked'
    },
    source: {
      type: String,
      enum: ['ai', 'direct'],
      default: 'direct'
    }
  },
  { timestamps: true }
);

panelSchema.index({ projectId: 1, position: 1 }, { unique: true });

module.exports = mongoose.model('Panel', panelSchema);
