const multer = require('multer');
const { uploadMenuImage } = require('../services/storageService');
const { toId } = require('../utils/scope');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

// Accepts an optional `image` file and stores it in Supabase Storage, exposing
// the public URL as req.file.publicUrl. Runs after `protect`.
const uploadImage = (req, res, next) => {
  upload.single('image')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (!req.file) return next();
    try {
      req.file.publicUrl = await uploadMenuImage(req.file.buffer, toId(req.user?.restaurant));
      return next();
    } catch {
      return res.status(500).json({ success: false, message: 'Error uploading image' });
    }
  });
};

module.exports = uploadImage;
