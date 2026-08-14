const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const News = require('../models/News');
const objectStorage = require('../services/objectStorage');
const { verifyToken, requireRole } = require('../middleware/auth');

function makeAbsoluteUrl(req, p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  const origin = (process.env.SERVER_URL && process.env.SERVER_URL.replace(/\/$/, '')) || `${req.protocol}://${req.get('host')}`;
  const rel = p.startsWith('/') ? p : '/' + p;
  return origin + rel;
}

function normalizeMedia(doc) {
  if (!doc) return doc;
  const out = Object.assign({}, doc && doc.toObject ? doc.toObject() : doc);

  const toPublic = (p) => {
    if (!p) return p;
    if (/^https?:\/\//i.test(p)) return p;
    if (objectStorage && objectStorage.enabled && (p.startsWith('/uploads/') || p.includes('/uploads/'))) {
      const fname = p.split('/').pop();
      if (fname) return objectStorage.getPublicUrl(`uploads/${fname}`);
    }
    return p;
  };

  out.imageUrl = toPublic(out.imageUrl || out.imagePath || '');
  out.adharImageUrl = toPublic(out.adharImageUrl || out.adharImagePath || '');
  return out;
}

let upload;
if (objectStorage && objectStorage.enabled) {
  upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
} else {
  const diskStorage = multer.diskStorage({
    destination: function (req, file, cb) {
      const dir = path.join(__dirname, '..', 'public', 'uploads');
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      cb(null, dir);
    },
    filename: function (req, file, cb) {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, unique + path.extname(file.originalname || ''));
    }
  });
  upload = multer({ storage: diskStorage, limits: { fileSize: 25 * 1024 * 1024 } });
}

async function persistUpload(req, file, prefix) {
  if (!file) return { url: '', path: '' };

  if (file.buffer && objectStorage && objectStorage.enabled) {
    const ext = path.extname(file.originalname || '') || '';
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${prefix}${ext}`;
    const key = `uploads/${filename}`;
    await objectStorage.uploadBuffer(file.buffer, key, file.mimetype);
    return { url: objectStorage.getPublicUrl(key), path: '' };
  }

  if (file.filename) {
    const rel = `/uploads/${file.filename}`;
    return { url: makeAbsoluteUrl(req, rel), path: rel };
  }

  return { url: '', path: '' };
}

// Public submit endpoint (no auth)
router.post('/submit', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'adharImage', maxCount: 1 }]), async (req, res) => {
  try {
    const { title, description, uploaderName, mobileNumber, adharCardNumber } = req.body;

    const imageFile = Array.isArray(req.files && req.files.image) ? req.files.image[0] : null;
    const adharImageFile = Array.isArray(req.files && req.files.adharImage) ? req.files.adharImage[0] : null;

    if (!title || !description || !uploaderName || !mobileNumber || !adharCardNumber || !imageFile || !adharImageFile) {
      return res.status(400).json({ success: false, message: 'All fields are mandatory' });
    }

    const image = await persistUpload(req, imageFile, 'public');
    const adhar = await persistUpload(req, adharImageFile, 'adhar');

    const item = new News({
      title: String(title).trim(),
      description: String(description).trim(),
      content: String(description).trim(),
      category: 'RR PUBLIC NEWS',
      author: String(uploaderName).trim(),
      imageUrl: image.url,
      imagePath: image.path || undefined,
      adharImageUrl: adhar.url,
      adharImagePath: adhar.path || undefined,
      uploaderName: String(uploaderName).trim(),
      mobileNumber: String(mobileNumber).trim(),
      adharCardNumber: String(adharCardNumber).trim(),
      isPublicSubmission: true,
      isUjala: false,
      approved: false,
      isBreaking: false,
      isFeatured: false,
    });

    await item.save();
    return res.json({ success: true, message: 'Public news submitted and pending approval', data: normalizeMedia(item) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// Public category listing for approved public news
router.get('/category', async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 12;
    const query = {
      approved: true,
      $or: [
        { isPublicSubmission: true },
        { category: 'RR PUBLIC NEWS' },
      ],
    };
    const total = await News.countDocuments(query);
    const items = await News.find(query)
      .sort({ isBreaking: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.json({
      success: true,
      data: items.map(normalizeMedia),
      pagination: { total, page, pages: Math.ceil(total / limit), limit }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// Superadmin: pending public submissions
router.get('/superadmin/pending', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const items = await News.find({
      approved: false,
      $or: [
        { isPublicSubmission: true },
        { category: 'RR PUBLIC NEWS' },
      ],
    }).sort({ createdAt: -1 });
    return res.json({ success: true, data: items.map(normalizeMedia) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// Superadmin: approved public submissions
router.get('/superadmin/approved', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const items = await News.find({
      approved: true,
      $or: [
        { isPublicSubmission: true },
        { category: 'RR PUBLIC NEWS' },
      ],
    }).sort({ createdAt: -1 });
    return res.json({ success: true, data: items.map(normalizeMedia) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// Superadmin: approve a public submission
router.put('/superadmin/:id/approve', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const item = await News.findById(id);
    if (!item || (!item.isPublicSubmission && item.category !== 'RR PUBLIC NEWS')) return res.status(404).json({ success: false, message: 'Not found' });

    item.approved = true;
    item.isPublicSubmission = true;
    item.category = 'RR PUBLIC NEWS';
    item.isBreaking = true;
    await item.save();

    return res.json({ success: true, message: 'Public news approved', data: normalizeMedia(item) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// Superadmin: edit a public submission
router.put('/superadmin/:id', verifyToken, requireRole('superadmin'), upload.fields([{ name: 'image', maxCount: 1 }, { name: 'adharImage', maxCount: 1 }]), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const item = await News.findById(id);
    if (!item || (!item.isPublicSubmission && item.category !== 'RR PUBLIC NEWS')) return res.status(404).json({ success: false, message: 'Not found' });

    const { title, description, uploaderName, mobileNumber, adharCardNumber } = req.body;
    if (title) item.title = String(title).trim();
    if (description) {
      item.description = String(description).trim();
      item.content = String(description).trim();
    }
    if (uploaderName) {
      item.uploaderName = String(uploaderName).trim();
      item.author = String(uploaderName).trim();
    }
    if (mobileNumber) item.mobileNumber = String(mobileNumber).trim();
    if (adharCardNumber) item.adharCardNumber = String(adharCardNumber).trim();

    const imageFile = Array.isArray(req.files && req.files.image) ? req.files.image[0] : null;
    const adharImageFile = Array.isArray(req.files && req.files.adharImage) ? req.files.adharImage[0] : null;

    if (imageFile) {
      const image = await persistUpload(req, imageFile, 'public-edit');
      if (image.url) item.imageUrl = image.url;
      if (image.path) item.imagePath = image.path;
    }

    if (adharImageFile) {
      const adhar = await persistUpload(req, adharImageFile, 'adhar-edit');
      if (adhar.url) item.adharImageUrl = adhar.url;
      if (adhar.path) item.adharImagePath = adhar.path;
    }

    item.category = 'RR PUBLIC NEWS';
    item.isPublicSubmission = true;
    await item.save();

    return res.json({ success: true, message: 'Public news updated', data: normalizeMedia(item) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// Superadmin: set/unset home featured
router.put('/superadmin/:id/feature', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const item = await News.findById(id);
    if (!item || (!(item.isPublicSubmission || item.category === 'RR PUBLIC NEWS') || !item.approved)) return res.status(404).json({ success: false, message: 'Not found' });

    item.isFeatured = true;
    item.featuredAt = new Date();
    await item.save();

    return res.json({ success: true, message: 'Public news marked as featured', data: normalizeMedia(item) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

router.put('/superadmin/:id/unfeature', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const item = await News.findById(id);
    if (!item || (!(item.isPublicSubmission || item.category === 'RR PUBLIC NEWS') || !item.approved)) return res.status(404).json({ success: false, message: 'Not found' });

    item.isFeatured = false;
    item.featuredAt = undefined;
    await item.save();

    return res.json({ success: true, message: 'Public news removed from featured', data: normalizeMedia(item) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// Superadmin: delete a public submission
router.delete('/superadmin/:id', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const item = await News.findById(id);
    if (!item || !item.isPublicSubmission) return res.status(404).json({ success: false, message: 'Not found' });

    await News.findByIdAndDelete(id);
    return res.json({ success: true, message: 'Public news deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

module.exports = router;
