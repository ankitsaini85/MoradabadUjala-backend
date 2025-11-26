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
        'Moradabad ujala',
        'ujala gallery',
        'ujala events'
      ],
    },
    imageUrl: {
      type: String,
      default: 'https://via.placeholder.com/800x450?text=News+Image',
    },
    imagePath: {
      type: String,
    },
    // For gallery posts: store multiple image URLs/paths
    galleryImages: {
      type: [String],
      default: [],
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
    // Flags for special Ujala subtypes
    isGallery: {
      type: Boolean,
      default: false,
    },
    isEvent: {
      type: Boolean,
      default: false,
    },
    // Event-specific fields
    eventDate: {
      type: Date,
    },
    eventVenue: {
      type: String,
    },
    approved: {
      type: Boolean,
      default: true,
    },
    author: {
      type: String,
      default: 'Moradabad Ujala',
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
    try {
      // Preserve Unicode letters (e.g., Hindi) when generating slugs.
      // Normalize to separate diacritics, remove combining marks, then strip anything
      // that's not a Unicode letter, number, space or hyphen.
      let slug = String(this.title).toLowerCase();
      if (slug.normalize) slug = slug.normalize('NFKD').replace(/\p{M}/gu, '');
      // allow Unicode letters (\p{L}) and numbers (\p{N}), spaces and hyphens
      slug = slug.replace(/[^\p{L}\p{N}\s-]+/gu, '');
      slug = slug.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
      // fallback if slug is empty (e.g., title had only unsupported characters)
      if (!slug) {
        slug = 'item-' + Date.now() + '-' + Math.round(Math.random() * 1e6);
      }
      this.slug = slug;
    } catch (e) {
      // In case the runtime doesn't support Unicode property escapes, fall back
      // to a basic ASCII-safe slug and a fallback unique id if empty.
      let slug = String(this.title).toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
      if (!slug) slug = 'item-' + Date.now() + '-' + Math.round(Math.random() * 1e6);
      this.slug = slug;
    }
  }
  next();
});

const News = mongoose.model('News', newsSchema);

module.exports = News;
