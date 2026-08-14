const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Video = require('../models/Video');
const { verifyToken, requireRole } = require('../middleware/auth');

function extractYoutubeId(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const directId = raw.match(/^[a-zA-Z0-9_-]{11}$/);
  if (directId) return directId[0];

  try {
    const url = new URL(raw);
    const host = (url.hostname || '').toLowerCase();

    if (host.includes('youtu.be')) {
      const id = (url.pathname || '').replace(/^\//, '').split('/')[0];
      if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }

    if (host.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

      const parts = (url.pathname || '').split('/').filter(Boolean);
      const candidate = parts[parts.length - 1];
      if (candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate)) return candidate;
    }
  } catch (e) {
    return null;
  }

  return null;
}

function toApi(videoDoc) {
  const item = videoDoc && videoDoc.toObject ? videoDoc.toObject() : videoDoc;
  return {
    _id: item._id,
    title: item.title,
    description: item.description,
    youtubeUrl: item.youtubeUrl,
    youtubeId: item.youtubeId,
    embedUrl: item.embedUrl,
    thumbnailUrl: item.thumbnailUrl,
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.max(1, Math.min(30, parseInt(req.query.limit || '6', 10)));

    const query = { isActive: true };
    const total = await Video.countDocuments(query);
    const items = await Video.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      success: true,
      data: items.map(toApi),
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

router.get('/admin/list', verifyToken, requireRole(['admin', 'superadmin']), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit || '10', 10)));

    const total = await Video.countDocuments({});
    const items = await Video.find({})
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      success: true,
      data: items.map(toApi),
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

router.post('/admin', verifyToken, requireRole(['admin', 'superadmin']), async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const youtubeUrl = String(req.body.youtubeUrl || '').trim();

    if (!title || !youtubeUrl) {
      return res.status(400).json({ success: false, message: 'title and youtubeUrl are required' });
    }

    const youtubeId = extractYoutubeId(youtubeUrl);
    if (!youtubeId) {
      return res.status(400).json({ success: false, message: 'Invalid YouTube URL. Paste a valid YouTube link.' });
    }

    const embedUrl = `https://www.youtube.com/embed/${youtubeId}`;
    const thumbnailUrl = `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;

    const creatorId = req.user && req.user.id;
    const validCreatorId = mongoose.Types.ObjectId.isValid(creatorId) ? creatorId : undefined;

    const item = new Video({
      title,
      description,
      youtubeUrl,
      youtubeId,
      embedUrl,
      thumbnailUrl,
      createdBy: validCreatorId,
    });

    await item.save();

    res.json({ success: true, message: 'Video added successfully', data: toApi(item) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

router.delete('/admin/:id', verifyToken, requireRole(['admin', 'superadmin']), async (req, res) => {
  try {
    const item = await Video.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Video not found' });
    res.json({ success: true, message: 'Video deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

module.exports = router;
