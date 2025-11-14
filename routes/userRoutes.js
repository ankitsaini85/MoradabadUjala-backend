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

// Approve a reporter
router.put('/reporters/:id/approve', auth.verifyToken, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'Reporter not found' });
    if (user.role !== 'reporter') return res.status(400).json({ success: false, message: 'Not a reporter account' });

    user.isApproved = true;
    await user.save();
    res.json({ success: true, message: 'Reporter approved', data: { id: user._id, isApproved: user.isApproved } });
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
