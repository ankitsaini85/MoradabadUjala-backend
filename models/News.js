const mongoose = require('mongoose');

const newsSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
    },
    description: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true,
      enum: [
        'breaking',
        'india',
        'world',
        'sports',
        'entertainment',
        'business',
        'technology',
        'health',
        'education',
        'lifestyle',
        'auto',
        'religion',
        'ujala',
        'Moradabad ujala'
      ],
    },
    imageUrl: {
      type: String,
      default: 'https://via.placeholder.com/800x450?text=News+Image',
    },
    imagePath: {
      type: String,
    },
    location: {
      type: String,
    },
    // If submitted by a reporter, store their user id
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    isUjala: {
      type: Boolean,
      default: false,
    },
    approved: {
      type: Boolean,
      default: true,
    },
    author: {
      type: String,
      default: 'Aaj Tak Team',
    },
    views: {
      type: Number,
      default: 0,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    featuredAt: {
      type: Date,
    },
    isBreaking: {
      type: Boolean,
      default: false,
    },
    tags: [String],
    source: {
      type: String,
      default: 'Moradabad Ujala',
    },
    videoUrl: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-generate slug from title
newsSchema.pre('save', function (next) {
  if (this.isModified('title')) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/--+/g, '-')
      .trim();
  }
  next();
});

const News = mongoose.model('News', newsSchema);

module.exports = News;
