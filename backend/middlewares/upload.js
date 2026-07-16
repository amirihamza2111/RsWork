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
        resource_type: 'image',
        // Incoming optimization: cap oversized phone photos to 1600px on the
        // long edge and let Cloudinary pick a good quality. This shrinks stored
        // files a lot while keeping a clean secure_url (no transform string in
        // the path), so the delete-by-public-id logic keeps working.
        transformation: [{ width: 1600, height: 1600, crop: 'limit', quality: 'auto:good' }],
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