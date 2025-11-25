require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./config/database');

const newsRoutes = require('./routes/newsRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const authRoutes = require('./routes/authRoutes');
const contactRoutes = require('./routes/contactRoutes');
const userRoutes = require('./routes/userRoutes');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors({
  origin: ["http://localhost:3000", "http://moradabadujala.in","https://moradabadujala.in"],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to AajTak Clone API',
    endpoints: {
      news: '/api/news',
      categories: '/api/categories',
      breaking: '/api/news/breaking',
      featured: '/api/news/featured',
      trending: '/api/news/trending',
    },
  });
});

app.use('/api/news', newsRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/users', userRoutes);

// Serve uploads statically
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Legacy share redirects: support old shared links that omit the /api/news prefix
// Redirect `/share/:slug` -> `/api/news/share/:slug`
app.get('/share/:slug', (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    if (!slug) return res.status(400).send('Bad Request');
    return res.redirect(301, `/api/news/share/${encodeURIComponent(slug)}`);
  } catch (err) {
    return res.status(500).send('Server error');
  }
});

// Support frontend builds that may call `/api/share/:slug` (missing `/news` segment)
app.get('/api/share/:slug', (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    if (!slug) return res.status(400).json({ success: false, message: 'Bad Request' });
    return res.redirect(301, `/api/news/share/${encodeURIComponent(slug)}`);
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`API documentation: http://localhost:${PORT}`);
});
