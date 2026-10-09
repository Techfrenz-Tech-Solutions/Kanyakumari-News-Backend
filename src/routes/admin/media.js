'use strict';

const { asyncHandler } = require('../../utils/apiError');
const mediaService = require('../../services/mediaService');

const upload = asyncHandler(async (req, res) => {
  const { buffer, originalname, size } = req.file;
  const kind = (req.body && req.body.kind) || null; // optional: 'image' | 'pdf' | 'video'
  const row = await mediaService.processUpload(buffer, originalname, size, {
    kind,
    userId: req.user.id,
    req,
  });
  res.status(201).json({ success: true, data: mediaService.mediaDto(row) });
});

const list = asyncHandler(async (req, res) => {
  const result = await mediaService.listMedia({
    q: req.query.q || req.query.search || null,
    kind: req.query.kind || null,
    page: parseInt(req.query.page, 10) || 1,
    limit: parseInt(req.query.limit, 10) || 24,
    req,
  });
  res.json({ success: true, data: result });
});

const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = await mediaService.deleteMedia({ id, req, userId: req.user.id });
  res.json({ success: true, data: result });
});

module.exports = { upload, list, remove };
