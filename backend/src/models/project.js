const mongoose = require('mongoose');
const { VISUAL_STYLES } = require('../config/story-options');

const projectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: ''
    },
    paletteNotes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: ''
    },
    visualStyle: {
      type: String,
      enum: VISUAL_STYLES.map((style) => style.id),
      required: true
    },
    characterAnchors: {
      type: [String],
      default: [],
      validate: {
        validator: (anchors) => anchors.length <= 12 && anchors.every((anchor) =>
          typeof anchor === 'string' && anchor.trim().length > 0 && anchor.length <= 500
        ),
        message: 'Character continuity notes must be up to 12 entries of 500 characters each.'
      }
    },
    styleLocked: {
      type: Boolean,
      default: true,
      immutable: true
    },
    status: {
      type: String,
      enum: ['draft', 'active', 'archived'],
      default: 'draft'
    }
  },
  { timestamps: true }
);

projectSchema.pre('validate', function lockNewProjectStyle() {
  if (this.isNew) {
    this.styleLocked = true;
  }
});

module.exports = mongoose.model('Project', projectSchema);
