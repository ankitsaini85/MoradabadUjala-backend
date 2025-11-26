const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const User = require('../models/User');
const auth = require('../middleware/auth');

// Admin registration (restricted: in production you would protect this or seed admin)
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Missing fields' });

    // Prevent creating superadmin via register
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'User already exists' });

    const user = new User({ name, email, password, role: 'admin', isApproved: true });
    await user.save();
    res.json({ success: true, message: 'Admin registered' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Multer setup for user avatar uploads (register)
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

// Reporter self-registration (will be pending approval)
router.post('/register-reporter', upload.single('avatar'), async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Missing fields' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'User already exists' });
    // generate a simple reporterId - try to make collision unlikely
    const makeReporterId = () => {
      const suffix = Date.now().toString().slice(-6);
      const rand = Math.floor(Math.random() * 900 + 100); // 100-999
      return `MB${suffix}${rand}`;
    };

    let reporterId = makeReporterId();
    // ensure uniqueness (rare) - try a few times
    for (let i = 0; i < 5; i++) {
      const found = await User.findOne({ reporterId });
      if (!found) break;
      reporterId = makeReporterId();
    }

    // if avatar uploaded, save path
    let user;
    if (req.file && req.file.filename) {
      user = new User({ name, email, password, role: 'reporter', isApproved: false, reporterId, avatar: `/uploads/${req.file.filename}` });
    } else {
      user = new User({ name, email, password, role: 'reporter', isApproved: false, reporterId });
    }
    await user.save();
    res.json({ success: true, message: 'Registered as reporter. Await superadmin approval.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });

      // If reporter, ensure approved
      if (user.role === 'reporter' && !user.isApproved) {
        return res.status(403).json({ success: false, message: 'Reporter account pending approval' });
      }

  const token = jwt.sign({ id: user._id, email: user.email, role: user.role, name: user.name }, process.env.JWT_SECRET || 'strong_secret', { expiresIn: process.env.JWT_EXPIRES || '1d' });
  // also return role and name for client convenience
  res.json({ success: true, token, role: user.role, name: user.name, id: user._id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Superadmin login (fixed credentials from .env)
router.post('/superadmin-login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const envEmail = process.env.SEED_SUPER_EMAIL;
    const envPass = process.env.SEED_SUPER_PASS;
    if (email === envEmail && password === envPass) {
      const token = jwt.sign({ id: 'superadmin', email, role: 'superadmin', name: 'Super Admin' }, process.env.JWT_SECRET || 'strong_secret', { expiresIn: process.env.JWT_EXPIRES || '1d' });
      return res.json({ success: true, token });
    }
    return res.status(401).json({ success: false, message: 'Invalid superadmin credentials' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

// Debug: return decoded token payload for the current Authorization header
router.get('/me', auth.verifyToken, (req, res) => {
  try {
    // req.user is set by verifyToken
    res.json({ success: true, data: req.user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

