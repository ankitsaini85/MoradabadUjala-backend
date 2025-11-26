const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');

// List reporter accounts (superadmin only)
router.get('/reporters', auth.verifyToken, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const reporters = await User.find({ role: 'reporter' }).select('-password');
    res.json({ success: true, data: reporters });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Return current user's public info (requires auth)
router.get('/me', auth.verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Approve a reporter
router.put('/reporters/:id/approve', auth.verifyToken, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'Reporter not found' });
    if (user.role !== 'reporter') return res.status(400).json({ success: false, message: 'Not a reporter account' });

    user.isApproved = true;
    // set approvedAt to now (used for validity period)
    user.approvedAt = user.approvedAt || new Date();
    // ensure reporterId exists (should be set at registration but guard just in case)
    if (!user.reporterId) {
      user.reporterId = `RJ${Date.now().toString().slice(-6)}${Math.floor(Math.random()*900+100)}`;
    }

    await user.save();
    res.json({ success: true, message: 'Reporter approved', data: { id: user._id, isApproved: user.isApproved, reporterId: user.reporterId, approvedAt: user.approvedAt } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete reporter
router.delete('/reporters/:id', auth.verifyToken, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'Reporter not found' });
    if (user.role !== 'reporter') return res.status(400).json({ success: false, message: 'Not a reporter account' });

    await user.remove();
    res.json({ success: true, message: 'Reporter deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
