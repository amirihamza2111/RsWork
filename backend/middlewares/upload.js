const multer = require('multer');
const cloudinary = require('../config/cloudinary');
const { Readable } = require('stream');
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, 
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});
const uploadImage = (req, res, next) => {
  const multerUpload = upload.single('image');
  multerUpload(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }
    if (!req.file) {
      return next();
    }
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'restaurant-app',
        resource_type: 'auto',
      },
      (error, result) => {
        if (error) {
          return res.status(500).json({
            success: false,
            message: 'Error uploading image to Cloudinary',
          });
        }
        req.file.cloudinaryUrl = result.secure_url;
        next();
      }
    );
    Readable.from(req.file.buffer).pipe(stream);
  });
};
module.exports = uploadImage;