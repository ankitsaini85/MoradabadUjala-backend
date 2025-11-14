const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
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

// Reporter self-registration (will be pending approval)
router.post('/register-reporter', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Missing fields' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'User already exists' });

    const user = new User({ name, email, password, role: 'reporter', isApproved: false });
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

