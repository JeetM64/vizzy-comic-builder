const express = require('express');
const mongoose = require('mongoose');
const { HttpError } = require('../utils/http-error');

function validateObjectId(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, 'A valid record ID is required.');
  }
}

function validatePayload(payload, fields, allowEmpty = false) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'The request body must be a JSON object.');
  }

  const unsupportedFields = Object.keys(payload).filter((field) => !fields.includes(field));
  if (unsupportedFields.length > 0) {
    throw new HttpError(400, `Unsupported field(s): ${unsupportedFields.join(', ')}.`);
  }
  if (!allowEmpty && Object.keys(payload).length === 0) {
    throw new HttpError(400, 'At least one field is required.');
  }

  return payload;
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createCrudRouter({ model, fields, filterFields = [], validate }) {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const filter = {};
      for (const field of filterFields) {
        if (req.query[field] !== undefined) {
          if (field === 'projectId') {
            validateObjectId(req.query[field]);
          }
          filter[field] = req.query[field];
        }
      }

      const records = await model.find(filter).sort({ createdAt: -1 }).limit(100).lean();
      res.json({ success: true, data: records });
    })
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const payload = validatePayload(req.body, fields, true);
      if (validate) await validate(payload);
      const record = await new model(payload).save();
      res.status(201).json({ success: true, data: record });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      validateObjectId(req.params.id);
      const record = await model.findById(req.params.id).lean();
      if (!record) {
        throw new HttpError(404, 'Record not found.');
      }
      res.json({ success: true, data: record });
    })
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      validateObjectId(req.params.id);
      const payload = validatePayload(req.body, fields);
      if (validate) await validate(payload);
      const record = await model.findByIdAndUpdate(req.params.id, payload, {
        new: true,
        runValidators: true
      });
      if (!record) {
        throw new HttpError(404, 'Record not found.');
      }
      res.json({ success: true, data: record });
    })
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      validateObjectId(req.params.id);
      const record = await model.findByIdAndDelete(req.params.id);
      if (!record) {
        throw new HttpError(404, 'Record not found.');
      }
      res.json({ success: true, data: record });
    })
  );

  return router;
}

module.exports = createCrudRouter;
