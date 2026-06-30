const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/auth');
const uploadImage = require('../middlewares/upload');
const {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
  createMenuItem,
  getMenuItems,
  getMenuItemById,
  updateMenuItem,
  deleteMenuItem,
  toggleAvailability,
  getRecommendations,
  refreshRecommendations,
} = require('../controllers/menuController');
router.post('/categories', protect, authorize('manager'), createCategory);
router.get('/', getMenuItems);
router.get('/recommendations', getRecommendations);
router.post(
  '/recommendations/refresh',
  protect,
  authorize('manager', 'superadmin'),
  refreshRecommendations
);
router.get('/categories', getCategories);
router.put('/categories/:id', protect, authorize('manager'), updateCategory);
router.delete('/categories/:id', protect, authorize('manager'), deleteCategory);
router.post('/items', protect, authorize('manager'), uploadImage, createMenuItem);
router.get('/items', getMenuItems);
router.get('/items/:id', getMenuItemById);
router.put('/items/:id', protect, authorize('manager'), uploadImage, updateMenuItem);
router.delete('/items/:id', protect, authorize('manager'), deleteMenuItem);
router.patch('/items/:id/toggle', protect, authorize('manager'), toggleAvailability);
module.exports = router;