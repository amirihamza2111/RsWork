const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/auth');
const {
  createRestaurant,
  getMyRestaurant,
  getMyRestaurants,
  updateRestaurant,
  getAllRestaurants,
} = require('../controllers/restaurantController');
router.use(protect);
router.post('/', authorize('manager','superadmin'), createRestaurant);
router.get('/mine', authorize('manager', 'superadmin'), getMyRestaurants);
router.get('/me', authorize('manager'), getMyRestaurant);
router.put('/:id', authorize('manager', 'superadmin'), updateRestaurant);
router.get('/', authorize('superadmin'), getAllRestaurants);
module.exports = router;