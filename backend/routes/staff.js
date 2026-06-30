const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/auth');
const { createStaffValidator } = require('../middlewares/validators');
const validate = require('../middlewares/validate');
const { getAllUsers, createStaff } = require('../controllers/userController');

router.get('/', protect, authorize('manager', 'superadmin'), getAllUsers);
router.post(
  '/',
  protect,
  authorize('manager', 'superadmin'),
  createStaffValidator,
  validate,
  createStaff
);

module.exports = router;
