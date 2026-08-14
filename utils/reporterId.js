const User = require('../models/User');

async function generateReporterId(now = new Date()) {
  const yy = String(now.getFullYear()).slice(-2);
  const prefix = `RRN-${yy}-`;
  const pattern = new RegExp(`^RRN-${yy}-(\\d{3})$`, 'i');

  // Read only same-year IDs and pick next sequence.
  const users = await User.find({ reporterId: { $regex: pattern } }).select('reporterId').lean();
  let maxSeq = -1;
  for (const u of users) {
    const value = String(u.reporterId || '');
    const m = value.match(/^(?:RRN)-(\d{2})-(\d{3})$/i);
    if (!m) continue;
    if (m[1] !== yy) continue;
    const seq = parseInt(m[2], 10);
    if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }

  let next = maxSeq + 1;
  if (next < 0) next = 0;

  // If sequence window exhausted, fallback to random attempts.
  if (next > 999) {
    for (let i = 0; i < 20; i++) {
      const seq = Math.floor(Math.random() * 1000);
      const candidate = `${prefix}${String(seq).padStart(3, '0')}`;
      // eslint-disable-next-line no-await-in-loop
      const existing = await User.findOne({ reporterId: candidate }).select('_id').lean();
      if (!existing) return candidate;
    }
    throw new Error('Could not generate unique reporterId');
  }

  const candidate = `${prefix}${String(next).padStart(3, '0')}`;
  return candidate;
}

module.exports = { generateReporterId };
