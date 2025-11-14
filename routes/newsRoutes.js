const express = require('express');
const router = express.Router();
const newsAPIService = require('../services/newsAPIService');
const News = require('../models/News');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { verifyToken, requireRole } = require('../middleware/auth');

// Multer setup for uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '..', 'public', 'uploads'));
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Get all news with LIVE API fetching
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const category = req.query.category;
    const search = req.query.search;

    let news = [];

    // If search query, use search API
    if (search) {
      news = await newsAPIService.searchNews(search, limit);
    } 
    // If category specified, fetch for that category
    else if (category && category !== 'all') {
      news = await newsAPIService.fetchTopHeadlines(category, limit);
    } 
    // Default: fetch general/breaking news
    else {
      news = await newsAPIService.fetchTopHeadlines('india', limit);
    }

    // Simple client-side pagination (API returns limited results)
    const total = news.length;
    const startIndex = (page - 1) * limit;
    const paginatedNews = news.slice(startIndex, startIndex + limit);

    res.json({
      success: true,
      data: paginatedNews,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
      source: 'live-api',
      message: 'Live news from GNews API'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message,
      hint: error.message.includes('API_KEY') 
        ? 'Add your GNews API key to backend/.env file' 
        : 'Check your internet connection or API key'
    });
  }
});

// Get breaking news (LIVE)
router.get('/breaking', async (req, res) => {
  try {
    const news = await newsAPIService.fetchBreakingNews(10);

    res.json({
      success: true,
      data: news,
      source: 'live-api',
      message: 'Live breaking news from GNews'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- DB-backed Ujala/admin/superadmin endpoints ---

// Admin upload form endpoint (admin token required)
router.post('/admin/upload', verifyToken, requireRole('admin'), upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
  try {
    const { title, description, content, author, location } = req.body;
    if (!title || !description || !content) return res.status(400).json({ success: false, message: 'Missing required fields' });

    const news = new News({
      title,
      description,
      content,
      author: author || 'Moradabad Ujala Team',
      category: 'ujala',
      isUjala: true,
      approved: false,
      location: location || '',
    });

    // handle files if provided
    if (req.files) {
      const imageFile = Array.isArray(req.files.image) ? req.files.image[0] : undefined;
      const videoFile = Array.isArray(req.files.video) ? req.files.video[0] : undefined;
      if (imageFile) {
        news.imagePath = `/uploads/${imageFile.filename}`;
        news.imageUrl = news.imagePath;
      }
      if (videoFile) {
        news.videoPath = `/uploads/${videoFile.filename}`;
        news.videoUrl = news.videoPath;
      }
    }

    await news.save();
    res.json({ success: true, message: 'News uploaded and pending approval', data: news });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Reporter upload endpoint (reporters submit news for approval)
router.post('/reporter/upload', verifyToken, requireRole(['reporter','admin']), upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
  try {
    const { title, description, content, author, location } = req.body;
    if (!title || !description || !content) return res.status(400).json({ success: false, message: 'Missing required fields' });

    const news = new News({
      title,
      description,
      content,
      // prefer provided author, else use name from token if available
      author: author || (req.user && req.user.name) || 'Reporter',
      category: 'Moradabad ujala',
      isUjala: true,
      approved: false,
      location: location || '',
    });

    if (req.files) {
      const imageFile = Array.isArray(req.files.image) ? req.files.image[0] : undefined;
      const videoFile = Array.isArray(req.files.video) ? req.files.video[0] : undefined;
      if (imageFile) {
        news.imagePath = `/uploads/${imageFile.filename}`;
        news.imageUrl = news.imagePath;
      }
      if (videoFile) {
        news.videoPath = `/uploads/${videoFile.filename}`;
        news.videoUrl = news.videoPath;
      }
    }

    // Attach reporter id if available
    if (req.user && req.user.id) news.reporterId = req.user.id;

    await news.save();
    res.json({ success: true, message: 'News submitted and pending approval', data: news });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Public ujala listing (only approved items)
router.get('/ujala', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    // List any item that has been marked as Ujala and approved — don't rely on category string
    const query = { isUjala: true, approved: true };
    const total = await News.countDocuments(query);
    // sort breaking items first, then by newest
    const docs = await News.find(query)
      .sort({ isBreaking: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    res.json({ success: true, data: docs, pagination: { total, page, pages: Math.ceil(total / limit), limit }, source: 'database' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Public share preview page for social platforms (Open Graph meta tags)
// Example: GET /api/news/share/:slug
router.get('/share/:slug', async (req, res) => {
  try {
    const rawSlug = String(req.params.slug || '');
    if (!rawSlug) return res.status(400).send('Bad Request');

    const item = await News.findOne({ slug: rawSlug });
    if (!item) return res.status(404).send('Not found');

    // derive origin (prefer configured SERVER_URL for production)
    const origin = (process.env.SERVER_URL && process.env.SERVER_URL.replace(/\/$/, '')) || `${req.protocol}://${req.get('host')}`;

    const makeAbsolute = (p) => {
      if (!p) return '';
      if (/^https?:\/\//i.test(p)) return p;
      const path = p.startsWith('/') ? p : '/' + p;
      return origin + path;
    };

    const title = (item.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const description = (item.description || item.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const pageUrl = (process.env.FRONTEND_URL || origin).replace(/\/$/, '') + `/news/${item.slug}`;
    const image = makeAbsolute(item.imageUrl || item.imagePath || '');
    const video = makeAbsolute(item.videoUrl || item.videoPath || '');

    const isVideo = Boolean(item.videoUrl || item.videoPath);

    // minimal HTML with OG tags — social platforms will fetch these when a URL is shared
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:type" content="${isVideo ? 'video.other' : 'article'}" />
  ${image ? `<meta property="og:image" content="${image}" />` : ''}
  ${image ? `<meta name="twitter:image" content="${image}" />` : ''}
  ${isVideo ? `<meta property="og:video" content="${video}" />` : ''}
  ${isVideo ? `<meta property="og:video:secure_url" content="${video}" />` : ''}
  ${isVideo ? `<meta property="og:video:type" content="video/mp4" />` : ''}
  <meta name="twitter:card" content="${isVideo ? 'player' : 'summary_large_image'}" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:url" content="${pageUrl}" />
  <link rel="canonical" href="${pageUrl}" />
</head>
<body>
  <p>Redirecting to <a href="${pageUrl}">${pageUrl}</a></p>
  <script>try{location.replace('${pageUrl}')}catch(e){}</script>
</body>
</html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Error in /share/:slug', err);
    res.status(500).send('Server error');
  }
});

// Superadmin: list pending approvals (superadmin token required)
router.get('/superadmin/approval', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const pending = await News.find({ isUjala: true, approved: false }).sort({ createdAt: -1 });
    res.json({ success: true, data: pending });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin: approve a news item
router.put('/superadmin/approval/:id/approve', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const id = req.params.id;
    const item = await News.findById(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    // mark as approved and ensure it is categorized correctly for ujala
    item.approved = true;
    item.isUjala = true;
    // If this news was created by a reporter, keep/set the category to 'Moradabad ujala'
    // Also, if category was already a ujala-like value, normalize to 'Moradabad ujala'.
    try {
      const existingCat = (item.category || '').toString().trim();
      if (item.reporterId || /ujala/i.test(existingCat)) {
        item.category = 'Moradabad ujala';
      } else if (!existingCat) {
        item.category = 'Moradabad ujala';
      }
    } catch (e) {
      item.category = 'Moradabad ujala';
    }
    // mark as breaking so it appears at top of ujala listing
    item.isBreaking = true;
    await item.save();
    res.json({ success: true, message: 'News approved', data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin: list all approved ujala news (for management)
router.get('/admin/approved-news', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const items = await News.find({ isUjala: true, approved: true }).sort({ createdAt: -1 });
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin: mark an approved news as featured (show on home)
router.put('/admin/approved-news/:id/feature', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const item = await News.findById(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    item.isFeatured = true;
    item.featuredAt = new Date();
    await item.save();
    res.json({ success: true, message: 'Marked as featured', data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin: unmark featured
router.put('/admin/approved-news/:id/unfeature', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const item = await News.findById(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    item.isFeatured = false;
    item.featuredAt = undefined;
    await item.save();
    res.json({ success: true, message: 'Removed from featured', data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin: delete an approved news (admin management)
router.delete('/admin/approved-news/:id', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const item = await News.findByIdAndDelete(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });

    // best-effort cleanup of media files
    try {
      const publicDir = path.join(__dirname, '..', 'public');
      const unlinkIfExists = (urlPath) => {
        if (!urlPath) return;
        const rel = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
        const fp = path.join(publicDir, rel);
        fs.unlink(fp, (err) => { if (err && err.code !== 'ENOENT') console.warn('Failed to unlink file', fp, err.message); });
      };
      unlinkIfExists(item.imagePath);
      unlinkIfExists(item.videoPath);
    } catch (cleanupErr) {
      console.warn('Cleanup error after deleting approved news', cleanupErr.message || cleanupErr);
    }

    res.json({ success: true, message: 'Approved news deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Public: DB-backed featured list (approved & admin-marked featured)
router.get('/featured-db', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const items = await News.find({ isUjala: true, approved: true, isFeatured: true })
      // sort by when it was marked featured (newest first), fallback to createdAt
      .sort({ featuredAt: -1, createdAt: -1 })
      .limit(limit);
    res.json({ success: true, data: items, source: 'database' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update a news item (admin or superadmin) - supports replacing image
router.put('/:id', verifyToken, requireRole('admin'), upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
  try {
    const id = req.params.id;
    const item = await News.findById(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });

    const { title, description, content, author, location, category } = req.body;
    if (title) item.title = title;
    if (description) item.description = description;
    if (content) item.content = content;
    if (author) item.author = author;
    if (location) item.location = location;
    if (category) item.category = category;

    if (req.files) {
      const imageFile = Array.isArray(req.files.image) ? req.files.image[0] : undefined;
      const videoFile = Array.isArray(req.files.video) ? req.files.video[0] : undefined;
      if (imageFile) {
        item.imagePath = `/uploads/${imageFile.filename}`;
        item.imageUrl = item.imagePath;
      }
      if (videoFile) {
        item.videoPath = `/uploads/${videoFile.filename}`;
        item.videoUrl = item.videoPath;
      }
    }

    await item.save();
    res.json({ success: true, message: 'News updated', data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete a news item (superadmin only)
router.delete('/:id', verifyToken, requireRole('superadmin'), async (req, res) => {
  try {
    const id = req.params.id;

    // Validate ObjectId early to avoid confusing CastError stack traces
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    // Use findByIdAndDelete for a single atomic operation
    const item = await News.findByIdAndDelete(id);
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });

    // Best-effort: remove associated files from disk (imagePath / videoPath)
    try {
      const publicDir = path.join(__dirname, '..', 'public');
      const unlinkIfExists = (urlPath) => {
        if (!urlPath) return;
        // urlPath may be like '/uploads/xxx.jpg' or just a relative path
        const rel = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
        const fp = path.join(publicDir, rel);
        fs.unlink(fp, (err) => {
          if (err && err.code !== 'ENOENT') console.warn('Failed to unlink file', fp, err.message);
        });
      };

      unlinkIfExists(item.imagePath);
      unlinkIfExists(item.videoPath);
    } catch (unlinkErr) {
      // Don't fail the whole request if file deletion has issues; just log
      console.warn('Error while trying to remove media files for deleted news', unlinkErr);
    }

    res.json({ success: true, message: 'News deleted' });
  } catch (err) {
    console.error('Error in DELETE /api/news/:id', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get featured news (LIVE)
router.get('/featured', async (req, res) => {
  try {
    // If no API key is configured, return an empty array instead of failing
    if (!newsAPIService.apiKey) {
      console.warn('No NEWS_API_KEY configured; /api/news/featured returning empty list');
      return res.json({ success: true, data: [], source: 'live-api', message: 'No API key configured; returning empty featured list' });
    }

    const news = await newsAPIService.fetchFeaturedNews(6);

    res.json({
      success: true,
      data: news,
      source: 'live-api',
      message: 'Live featured news from multiple categories'
    });
  } catch (error) {
    console.error('Error in GET /api/news/featured', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get trending news (LIVE - mix of categories)
router.get('/trending', async (req, res) => {
  try {
    // Fetch from popular categories
    const [sports, entertainment, business] = await Promise.all([
      newsAPIService.fetchTopHeadlines('sports', 4),
      newsAPIService.fetchTopHeadlines('entertainment', 3),
      newsAPIService.fetchTopHeadlines('business', 3)
    ]);

    const news = [...sports, ...entertainment, ...business];

    res.json({
      success: true,
      data: news,
      source: 'live-api',
      message: 'Live trending news from popular categories'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get single news by slug (Note: For live API, we don't have individual article endpoints)
// This will search for the article title in the API
router.get('/:slug', async (req, res) => {
  try {
    const rawSlug = String(req.params.slug || '');

    // Try DB first (for ujala or any saved news)
    try {
      const dbItem = await News.findOne({ slug: rawSlug });
      if (dbItem) {
        // If it's a ujala item and not approved, treat as not found
        if (dbItem.isUjala && !dbItem.approved) {
          return res.status(404).json({ success: false, message: 'News not found' });
        }
        return res.json({ success: true, data: dbItem, source: 'database', message: 'News detail from database' });
      }
    } catch (dbErr) {
      // continue to live API search if DB lookup fails
      console.warn('DB lookup failed for slug:', rawSlug, dbErr.message || dbErr);
    }

    // If we have a cached live-article for this slug, return it immediately
    const cached = newsAPIService.getArticleBySlug(rawSlug);
    if (cached) {
      return res.json({ success: true, data: cached, source: 'live-cache', message: 'Live article from cache' });
    }

    // Split into tokens and sanitize
    const tokens = rawSlug
      .split('-')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    // Keep tokens that contain at least 3 letters (Latin or Devanagari) to avoid numeric-only queries
    const goodTokens = tokens.filter((t) => /([A-Za-z]{3,}|[\u0900-\u097F]{3,})/.test(t));

    // Take up to 4 tokens to build a concise search term
    const searchTerm = goodTokens.slice(0, 4).join(' ').trim();

    if (!searchTerm) {
      // Can't form a valid search query from slug — avoid calling external API with bad query
      console.warn('Slug to searchTerm produced no valid tokens:', { rawSlug, tokens, goodTokens });
      return res.status(404).json({ success: false, message: 'News not found' });
    }

    // Perform live search using sanitized term
    const results = await newsAPIService.searchNews(searchTerm, 1);

    if (!results || results.length === 0) {
      return res.status(404).json({ success: false, message: 'News not found' });
    }

    res.json({ success: true, data: results[0], source: 'live-api', message: 'Live news detail' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Clear cache endpoint (optional - for manual refresh)
router.post('/cache/clear', (req, res) => {
  try {
    newsAPIService.clearCache();
    res.json({
      success: true,
      message: 'Cache cleared successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
