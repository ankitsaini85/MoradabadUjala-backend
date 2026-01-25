const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const objectStorage = require('../services/objectStorage');

// List reporter accounts (superadmin only)
router.get('/reporters', auth.verifyToken, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const reporters = await User.find({ role: 'reporter' }).select('-password').lean();
    // Normalize avatar: prefer DB blob -> data URL; else ensure local /uploads file exists, otherwise clear to avoid 404s
    const fs = require('fs');
    const path = require('path');
    const origin = (process.env.SERVER_URL && process.env.SERVER_URL.replace(/\/$/, '')) || `${req.protocol}://${req.get('host')}`;
    const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
    const mapped = reporters.map(u => {
      let avatar = '';
      if (u.avatarData && u.avatarMime) {
        try { avatar = `data:${u.avatarMime};base64,${Buffer.from(u.avatarData).toString('base64')}`; } catch (e) { avatar = ''; }
      }
      if (!avatar) {
        if (u.avatar && /^https?:\/\//i.test(u.avatar)) {
          // If objectStorage enabled and avatar looks like an R2 URL or contains uploads, prefer a signed URL
          if (objectStorage && objectStorage.enabled && (u.avatar.includes('/uploads/') )) {
            try {
              const fname = (u.avatar || '').split('/').pop();
              if (fname) avatar = objectStorage.getSignedUrl(`uploads/${fname}`);
              else avatar = u.avatar;
            } catch (e) {
              avatar = u.avatar;
            }
          } else avatar = u.avatar;
        } else if (u.avatar && u.avatar.startsWith('/uploads/')) {
          // check file exists locally
          const rel = u.avatar.startsWith('/') ? u.avatar.slice(1) : u.avatar;
          const abs = path.join(__dirname, '..', rel);
          try {
            if (fs.existsSync(abs)) avatar = origin + (u.avatar.startsWith('/') ? u.avatar : '/' + u.avatar);
            else {
              // if object storage enabled, try signed URL for the filename
              if (objectStorage && objectStorage.enabled) {
                const fname = (u.avatar || '').split('/').pop();
                if (fname) {
                  try { avatar = objectStorage.getSignedUrl(`uploads/${fname}`); } catch (e) { avatar = ''; }
                }
              } else avatar = '';
            }
          } catch (e) { avatar = ''; }
        } else avatar = '';
      }
      const out = Object.assign({}, u);
      out.avatar = avatar;
      out.pressRole = u.pressRole || '';
      out.dob = u.dob || '';
      out.bloodGroup = u.bloodGroup || '';
      out.address = u.address || '';
      delete out.avatarData;
      delete out.avatarMime;
      // include region in public response (if present)
      out.region = u.region || '';
      return out;
    });
    res.json({ success: true, data: mapped });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Return current user's public info (requires auth)
router.get('/me', auth.verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const origin = (process.env.SERVER_URL && process.env.SERVER_URL.replace(/\/$/, '')) || `${req.protocol}://${req.get('host')}`;
    let avatar = '';
    if (user.avatarData && user.avatarMime) {
      try {
        avatar = `data:${user.avatarMime};base64,${user.avatarData.toString('base64')}`;
      } catch (e) {
        avatar = '';
      }
    }
    if (!avatar) {
      avatar = user.avatar ? ( /^https?:\/\//i.test(user.avatar) ? user.avatar : origin + (user.avatar.startsWith('/') ? user.avatar : '/' + user.avatar) ) : '';
    }

    const out = user.toObject();
    out.avatar = avatar;
    // remove binary fields from API response to reduce payload
    delete out.avatarData;
    delete out.avatarMime;
    // include region for frontend
    out.region = user.region || '';
    // include display role for press card
    out.pressRole = user.pressRole || '';
    // include back-card fields
    out.dob = user.dob || '';
    out.bloodGroup = user.bloodGroup || '';
    out.address = user.address || '';

    res.json({ success: true, data: out });
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

    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Reporter deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Submit consent form (reporter fills and submits)
router.post('/consent-form', auth.verifyToken, auth.requireRole(['reporter','admin']), async (req, res) => {
  try {
    const { fatherName, dateOfBirth, gender, maritalStatus, bloodGroup, mobileNumber, alternateMobile, email, address, reporterRole, qualification, profession, appointmentDate, pressCardDate, photo, signature } = req.body;
    
    if (!fatherName || !mobileNumber || !email) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Initialize consent data
    const consentData = {
      fatherName,
      dateOfBirth,
      gender,
      maritalStatus,
      bloodGroup,
      mobileNumber,
      alternateMobile,
      email,
      address,
      reporterRole,
      qualification,
      profession,
      appointmentDate,
      pressCardDate,
      consentSubmittedAt: new Date(),
    };

    // Upload photo to R2 if provided
    if (photo && photo.startsWith('data:image')) {
      try {
        const base64Data = photo.split(',')[1];
        if (base64Data) {
          const buffer = Buffer.from(base64Data, 'base64');
          const photoKey = `consent-forms/photo-${user._id}-${Date.now()}.jpg`;
          const uploadResult = await objectStorage.uploadBuffer(buffer, photoKey, 'image/jpeg');
          consentData.photoFile = objectStorage.getPublicUrl(photoKey);
          consentData.photo = objectStorage.getPublicUrl(photoKey); // Store URL instead of base64
        }
      } catch (photoErr) {
        console.error('Photo upload error:', photoErr.message);
        // Continue without photo if upload fails
      }
    }

    // Upload signature to R2 if provided
    if (signature && signature.startsWith('data:image')) {
      try {
        const base64Data = signature.split(',')[1];
        if (base64Data) {
          const buffer = Buffer.from(base64Data, 'base64');
          const signatureKey = `consent-forms/signature-${user._id}-${Date.now()}.jpg`;
          const uploadResult = await objectStorage.uploadBuffer(buffer, signatureKey, 'image/jpeg');
          consentData.signatureFile = objectStorage.getPublicUrl(signatureKey);
          consentData.signature = objectStorage.getPublicUrl(signatureKey); // Store URL instead of base64
        }
      } catch (sigErr) {
        console.error('Signature upload error:', sigErr.message);
        // Continue without signature if upload fails
      }
    }

    // Update user consent data
    user.consentData = consentData;
    user.isConsent = true;

    await user.save();
    res.json({ success: true, message: 'Consent form submitted successfully', data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get consent forms (superadmin only)
router.get('/consent-forms', auth.verifyToken, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    const total = await User.countDocuments({ isConsent: true, role: 'reporter' });
    const forms = await User.find({ isConsent: true, role: 'reporter' })
      .select('name email reporterId consentData isApproved')
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ 'consentData.consentSubmittedAt': -1 });

    res.json({ 
      success: true, 
      data: forms, 
      pagination: { total, page, pages: Math.ceil(total / limit), limit } 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

// Public: reviewer card data (used to render press ID previews)
// Example: GET /api/users/reporters/:id/card
router.get('/reporters/:id/card', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ success: false, message: 'Bad request' });
    const user = await User.findById(id).select('-password');
    if (!user || user.role !== 'reporter') return res.status(404).json({ success: false, message: 'Reporter not found' });
    if (!user.isApproved) return res.status(403).json({ success: false, message: 'Reporter not approved yet' });

    const origin = (process.env.SERVER_URL && process.env.SERVER_URL.replace(/\/$/, '')) || `${req.protocol}://${req.get('host')}`;
    let avatar = '';
    if (user.avatarData && user.avatarMime) {
      try {
        avatar = `data:${user.avatarMime};base64,${user.avatarData.toString('base64')}`;
      } catch (e) {
        avatar = '';
      }
    }
    if (!avatar) {
      avatar = user.avatar ? ( /^https?:\/\//i.test(user.avatar) ? user.avatar : origin + (user.avatar.startsWith('/') ? user.avatar : '/' + user.avatar) ) : '';
    }

    // Calculate validity: 1 year from approvedAt (if approvedAt missing, use createdAt)
    const base = user.approvedAt || user.createdAt || new Date();
    const validUntil = new Date(base);
    validUntil.setFullYear(validUntil.getFullYear() + 1);

    res.json({
      success: true,
      data: {
        id: user.reporterId || '',
        name: user.name,
        avatar,
        approvedAt: user.approvedAt,
        validUntil: validUntil.toISOString(),
        roleLabel: user.pressRole && user.pressRole.trim() ? user.pressRole : 'Reporter',
        region: user.region || '',
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
